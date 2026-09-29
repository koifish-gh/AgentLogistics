// 仿真状态中心：单一数据源 + 发布订阅。
// 组件只读 store，不直接 fetch；数据由 api(真实) 与 mock(兜底) 提供。

import * as api from './api.js';
import { DEFAULT_MAP, DEFAULT_ROBOTS } from './constants.js';
import { mockSnapshot, mockRobotExtras, mockAgentDecisions, warehouseZones, deriveCongestion } from './mock.js';
import { values } from './util.js';

const DEFAULT_TOGGLES = {
  paths: true,
  heat: false,
  orders: true,
  grid: false,
  congestion: true,
  fault: true,
};

export const store = {
  backend: api.backend,
  connected: false,
  mockMode: false,

  world: null,
  kpis: null,

  playing: false,
  stepping: false,
  speed: 1,
  strategy: 'nearest',
  seed: 42,
  autoOrders: true,

  projection: 'iso',
  toggles: { ...DEFAULT_TOGGLES },
  selected: null,
  lastSeq: 0,
  hiddenSeq: 0,

  motion: new Map(),
  headings: new Map(),
  kpiHistory: { utilization: [], throughput: [], wait: [], pending: [] },
  metricsSeries: { throughput: [], avgTime: [], utilization: [], congestion: [], fault: [] },

  extras: {},
  congestion: [],
  zones: { pickup: [], dropoff: [] },
  agentDecisions: [],
  agentTrace: [],

  scenario: null,
  _listeners: new Set(),
  _streamClose: null,
  _timer: 0,
  _playLoop: null,

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },
  notify(tag, payload) {
    for (const fn of this._listeners) fn(tag, payload);
  },
  set(partial, tag) {
    Object.assign(this, partial);
    this.notify(tag || 'state');
  },

  data() {
    return {
      world: this.world,
      kpis: this.kpis,
      extras: this.extras,
      congestion: this.congestion,
      zones: this.zones,
      agentDecisions: this.agentDecisions,
      mockMode: this.mockMode,
      connected: this.connected,
      backend: this.backend,
    };
  },

  async boot() {
    this._streamClose?.();
    if (this.backend === 'sim') {
      this._streamClose = api.connectStream((snapshot) => {
        if (snapshot == null) {
          if (!this.world) this.enterMock();
          this.set({ connected: false });
          return;
        }
        this.applySnapshot(snapshot, true);
        this.set({ connected: true });
      });
    }
    try {
      await api.getState(); // 探测连通性
      this.set({ connected: true, mockMode: false });
      await this.reset(this.seed); // 重置为配置的默认地图（更大更真实）
    } catch (error) {
      this.enterMock();
      console.warn('后端未连接，使用 Mock 数据：', error.message);
    }
    await this.refreshAgent();
  },

  enterMock() {
    const snap = mockSnapshot(this.world?.tick ?? 0);
    this.applySnapshot(snap, false);
    this.set({ mockMode: true, connected: false });
  },

  applySnapshot(payload, animate = true) {
    const data = payload?.data || payload || {};
    const world = data.world || payload?.world;
    const kpis = data.kpis || payload?.kpis;
    if (!world) return;

    const now = performance.now();
    const duration = this.stepInterval() * 0.82;
    for (const robot of values(world.robots)) {
      const prev = this.motion.get(robot.id);
      const to = robot.position;
      const from = prev ? this._displayPos(robot.id, now) : to;
      const moved = prev && (from.x !== to.x || from.y !== to.y);
      this.motion.set(robot.id, {
        from: moved && animate ? from : to,
        to,
        t0: now,
        dur: moved && animate ? duration : 0,
      });
    }

    this.world = world;
    if (kpis) this.kpis = kpis;
    this.lastSeq = world.events?.at(-1)?.sequence ?? this.lastSeq;
    this._enrich();
    this._pushHistory(kpis || this.kpis);
    this.notify('world');
  },

  _enrich() {
    if (!this.world) return;
    const robots = this.world.robots || {};
    const tick = this.world.tick ?? 0;
    this.extras = mockRobotExtras(robots, tick);
    this.zones = warehouseZones(this.world.map);
    this.congestion = deriveCongestion(this.world);
    // Agent 决策只在 Mock 演示模式下填充示例；真实后端（sim / agent rule）不伪造
    if (this.mockMode) {
      this.agentDecisions = mockAgentDecisions(tick);
    }
  },

  _pushHistory(kpis) {
    if (!kpis) return;
    const push = (list, value) => {
      list.push(value);
      if (list.length > 60) list.shift();
    };
    push(this.kpiHistory.utilization, kpis.utilization || 0);
    push(this.kpiHistory.throughput, kpis.throughput_per_100_ticks || 0);
    push(this.kpiHistory.wait, kpis.total_wait_ticks || 0);
    push(this.kpiHistory.pending, kpis.pending_orders || 0);

    push(this.metricsSeries.throughput, kpis.throughput_per_100_ticks || 0);
    push(this.metricsSeries.avgTime, kpis.average_completion_ticks || 0);
    push(this.metricsSeries.utilization, (kpis.utilization || 0) * 100);
    push(this.metricsSeries.congestion, this.congestion.length);
    push(this.metricsSeries.fault, kpis.faulted_robots || 0);
  },

  _displayPos(id, now = performance.now()) {
    const motion = this.motion.get(id);
    if (!motion) return { x: 0, y: 0 };
    if (!motion.dur) return motion.to;
    const t = Math.min(1, (now - motion.t0) / motion.dur);
    const e = 1 - (1 - t) ** 3;
    return {
      x: motion.from.x + (motion.to.x - motion.from.x) * e,
      y: motion.from.y + (motion.to.y - motion.from.y) * e,
    };
  },
  displayPos(id) {
    return this._displayPos(id);
  },

  stepInterval() {
    return 900 / this.speed;
  },

  async stepOnce() {
    if (this.stepping) return;
    this.stepping = true;
    try {
      if (this.mockMode) {
        const snap = mockSnapshot((this.world?.tick ?? 0) + 1);
        this.applySnapshot(snap, true);
      } else if (this.backend === 'agent') {
        const result = await api.agentDecide(1);
        this.applySnapshot(result, true);
        await this.refreshAgent();
      } else {
        await api.command({ op: 'step', ticks: 1 });
        if (!this.connected) await this.reload();
      }
    } catch (error) {
      this.stopPlay();
      this.notify('error', error);
    } finally {
      this.stepping = false;
    }
  },

  async reload() {
    try {
      const payload = await api.getState();
      this.applySnapshot(payload, false);
      this.set({ connected: true });
    } catch (error) {
      this.set({ connected: false });
      throw error;
    }
  },

  startPlay() {
    this.set({ playing: true });
    const loop = () => {
      if (!this.playing) return;
      this.stepOnce().finally(() => {
        if (this.playing) this._timer = setTimeout(loop, this.stepInterval());
      });
    };
    loop();
  },
  stopPlay() {
    this.set({ playing: false });
    clearTimeout(this._timer);
  },
  togglePlay() {
    if (this.playing) this.stopPlay();
    else this.startPlay();
  },

  async reset(seed, map = DEFAULT_MAP, robots = DEFAULT_ROBOTS) {
    this.stopPlay();
    this.scenario = null;
    this.hiddenSeq = 0;
    this.headings = new Map();
    this.kpiHistory = { utilization: [], throughput: [], wait: [], pending: [] };
    this.metricsSeries = { throughput: [], avgTime: [], utilization: [], congestion: [], fault: [] };
    this.agentDecisions = [];
    this.seed = seed;
    if (this.mockMode) {
      this.applySnapshot(mockSnapshot(0), false);
      return;
    }
    const result = await api.resetWorld({ seed, map, robots });
    this.applySnapshot(result, false);
    if (this.backend === 'sim') await api.command({ op: 'set_strategy', strategy: this.strategy });
    await this.refreshAgent();
  },

  async setStrategy(strategy) {
    this.strategy = strategy;
    if (this.mockMode) {
      if (this.world) this.world.strategy = strategy;
      this.notify('world');
      return;
    }
    await api.command({ op: 'set_strategy', strategy });
  },

  async generateOrders(count) {
    if (this.mockMode) {
      this.notify('error', new Error('Mock 模式不生成订单'));
      return;
    }
    await api.command({ op: 'generate_orders', count });
    if (this.backend === 'agent') await this.reload();
  },

  async dispatch() {
    if (this.mockMode) return;
    await api.command({ op: 'dispatch' });
    if (this.backend === 'agent') await this.reload();
  },

  // 手动派单：把指定待分配订单分配给指定空闲机器人
  async assignOrder(robotId, orderId) {
    if (this.mockMode) {
      this.notify('error', new Error('Mock 模式不支持手动派单'));
      return;
    }
    await api.command({ op: 'assign_order', robot_id: robotId, order_id: orderId });
    if (this.backend === 'agent') await this.reload();
  },

  async injectFault(robotId) {
    if (this.mockMode) return;
    const robot = this.world?.robots?.[robotId];
    const op = robot?.state === 'faulted' ? 'repair_robot' : 'inject_fault';
    await api.command({ op, robot_id: robotId });
    if (this.backend === 'agent') await this.reload();
  },

  async setBlocked(position, blocked) {
    if (this.mockMode) return;
    await api.command({ op: 'set_blocked', position, blocked });
    if (this.backend === 'agent') await this.reload();
  },

  // 场景事件注入（部分映射到真实命令，其余为前端演示）
  async injectSceneEvent(key) {
    if (this.mockMode) {
      this.notify('toast', `已注入场景事件：${key}`);
      return;
    }
    const robot = values(this.world?.robots || {})[0];
    if (key === 'robot_fault' && robot) {
      await api.command({ op: 'inject_fault', robot_id: robot.id });
    } else if (key === 'order_burst') {
      await api.command({ op: 'generate_orders', count: 5 });
    } else if (key === 'shelf_block') {
      const free = this._freeCell();
      if (free) await api.command({ op: 'set_blocked', position: free, blocked: true });
    } else {
      this.notify('toast', '通道拥堵：等待绕行事件已注入');
      return;
    }
    if (this.backend === 'agent') await this.reload();
    this.notify('toast', `已注入场景事件：${key}`);
  },

  _freeCell() {
    const map = this.world?.map;
    if (!map) return null;
    const shelf = new Set((map.obstacles || []).map((p) => `${p.x},${p.y}`));
    const blocked = new Set((map.blocked || []).map((p) => `${p.x},${p.y}`));
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (!shelf.has(`${x},${y}`) && !blocked.has(`${x},${y}`) && x > 0 && x < map.width - 1) return { x, y };
      }
    }
    return null;
  },

  async refreshAgent() {
    if (this.backend !== 'agent') return;
    try {
      const trace = await api.agentTrace();
      this.agentTrace = trace || [];
      this.agentDecisions = deriveAgentDecisions(this.agentTrace);
      this.notify('agent');
    } catch {
      /* 忽略 */
    }
  },

  select(sel) {
    this.selected = sel;
    this.notify('select');
  },

  setToggle(key, value) {
    this.toggles[key] = value;
    this.notify('toggle');
  },
  setProjection(mode) {
    this.projection = mode;
    this.notify('projection');
  },
};

// 由真实 Agent trace 派生结构化决策；无 trace 时返回空（不伪造）
function deriveAgentDecisions(trace) {
  if (!trace || !trace.length) return [];
  return trace.slice(-6).map((turn) => ({
    tick: turn.tick,
    title: turn.explanation || '规则策略决策',
    robotId: null,
    steps: (turn.actions || []).map((a) => a.name || a.role || 'step'),
    reasons: turn.explanation ? [turn.explanation] : [],
  }));
}
