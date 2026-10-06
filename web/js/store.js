// 仿真状态中心：单一数据源 + 发布订阅。
// 组件只读 store，不直接 fetch；数据由 api(真实) 与 mock(兜底) 提供。

import * as api from './api.js';
import { DEFAULT_MAP, DEFAULT_ROBOTS } from './constants.js';
import { mockSnapshot, mockRobotExtras, mockAgentDecisions, warehouseZones, deriveCongestion } from './mock.js';
import { values } from './util.js';

const PREF_KEY = 'al-prefs';
const SESSION_KEY = 'al-session';
const DEFAULT_TOGGLES = {
  paths: true,
  heat: false,
  orders: true,
  grid: false,
  congestion: true,
  fault: true,
};

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function headOn(robots) {
  const moving = robots.filter((robot) => (
    robot.path?.length && (robot.state === 'to_pickup' || robot.state === 'to_dropoff')
  ));
  return moving.some((robot) => {
    const next = robot.path[0];
    const other = moving.find((item) => item.position?.x === next.x && item.position?.y === next.y);
    if (!other?.path?.[0]) return false;
    const back = other.path[0];
    const dx = Math.sign(next.x - robot.position.x);
    const dy = Math.sign(next.y - robot.position.y);
    const odx = Math.sign(back.x - other.position.x);
    const ody = Math.sign(back.y - other.position.y);
    const mutual = back.x === robot.position.x && back.y === robot.position.y;
    const opposite = dx === -odx && dy === -ody && (dx !== 0 || dy !== 0);
    return mutual || opposite;
  });
}

function normalizeSeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 42;
  return Math.max(0, Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER));
}

function normalizeCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 20;
  return Math.max(0, Math.min(1000, Math.floor(n)));
}

const prefs = readPrefs();
const savedToggles = prefs.toggles && typeof prefs.toggles === 'object' ? prefs.toggles : {};

export const store = {
  backend: api.backend,
  connected: false,
  mockMode: false,

  world: null,
  kpis: null,

  playing: false,
  stepping: false,
  deciding: false,
  decideStarted: 0,
  faultHandled: new Set(),
  orderSurge: false,
  orderSurgeCount: 0,
  sceneLog: [],
  speed: [0.5, 1, 2, 4].includes(Number(prefs.speed)) ? Number(prefs.speed) : 1,
  strategy: ['nearest', 'balanced', 'manual'].includes(prefs.strategy) ? prefs.strategy : 'nearest',
  seed: normalizeSeed(prefs.seed ?? 42),
  autoOrders: prefs.autoOrders !== false,
  orderCount: normalizeCount(prefs.orderCount ?? 20),
  theme: prefs.theme === 'dark' ? 'dark' : 'light',
  density: prefs.density === 'compact' ? 'compact' : 'comfortable',

  projection: ['iso', 'top', 'side'].includes(prefs.projection) ? prefs.projection : 'iso',
  toggles: { ...DEFAULT_TOGGLES, ...savedToggles },
  selected: null,
  focusRequest: null,
  candidateEval: null,
  lastError: '',
  lastSeq: 0,
  hiddenSeq: 0,

  motion: new Map(),
  headings: new Map(),
  kpiHistory: { utilization: [], throughput: [], wait: [], pending: [], avgTime: [] },
  metricsSeries: { throughput: [], avgTime: [], utilization: [], congestion: [], fault: [], robots: {} },

  extras: {},
  extrasMode: 'live',
  congestion: [],
  blockBook: { points: [], segments: [] },
  segmentPick: null,
  orderDraft: null,
  zones: { pickup: [], dropoff: [] },
  agentDecisions: [],
  agentTrace: [],
  agentStatus: {},

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
    if (tag === 'error') this.lastError = payload?.message || String(payload || '');
    for (const fn of this._listeners) fn(tag, payload);
  },
  set(partial, tag) {
    Object.assign(this, partial);
    if (partial && ('theme' in partial || 'density' in partial)) this.applyChrome();
    if (partial && ['speed', 'strategy', 'seed', 'autoOrders', 'orderCount', 'theme', 'density'].some((key) => key in partial)) {
      this._savePrefs();
    }
    this.notify(tag || 'state');
  },

  applyChrome() {
    document.documentElement.dataset.theme = this.theme;
    document.documentElement.dataset.density = this.density;
  },

  _savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        theme: this.theme,
        density: this.density,
        orderCount: this.orderCount,
        speed: this.speed,
        strategy: this.strategy,
        seed: this.seed,
        autoOrders: this.autoOrders,
        projection: this.projection,
        toggles: this.toggles,
      }));
    } catch {
      /* 隐私模式等环境可忽略 */
    }
  },

  summary() {
    const robots = values(this.world?.robots || {});
    const orders = values(this.world?.orders || {});
    const kpis = this.kpis || {};
    const count = (state) => orders.filter((order) => order.state === state).length;
    return {
      tick: this.world?.tick ?? kpis.tick ?? 0,
      robots: robots.length,
      running: robots.filter((robot) => robot.state === 'to_pickup' || robot.state === 'to_dropoff').length,
      idle: robots.filter((robot) => robot.state === 'idle').length,
      faulted: robots.filter((robot) => robot.state === 'faulted').length,
      orders: Number.isFinite(kpis.total_orders) ? kpis.total_orders : orders.length,
      completed: Number.isFinite(kpis.completed_orders) ? kpis.completed_orders : count('completed'),
      pending: Number.isFinite(kpis.pending_orders) ? kpis.pending_orders : count('pending'),
      assigned: count('assigned'),
      inTransit: count('in_transit'),
      active: Number.isFinite(kpis.active_orders) ? kpis.active_orders : count('assigned') + count('in_transit'),
      abnormal: orders.filter((order) => order.recovery_from).length,
    };
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
    this.applyChrome();
    this._streamClose?.();
    if (this.backend === 'sim') {
      this._streamClose = api.connectStream((snapshot) => {
        if (snapshot == null) {
          if (!this.world) this.enterMock('仿真服务未连接');
          else this.set({ connected: false });
          return;
        }
        this.mockMode = false;
        this.applySnapshot(snapshot, true);
        this.set({ connected: true, mockMode: false });
      });
    }
    if (!this._unloadBound) {
      this._unloadBound = true;
      window.addEventListener('beforeunload', () => this._saveSession());
    }
    const saved = loadSession();
    try {
      const live = await api.getState();
      this.lastError = '';
      this.set({ connected: true, mockMode: false });
      if (!this._isUntouchedServer(live)) {
        this.applySnapshot(live, false);
        await this.refreshAgent();
        if (saved?.world && this._canResume(live, saved)) {
          if (!this.agentTrace?.length && saved.agentTrace?.length) {
            this.agentTrace = saved.agentTrace;
            this.agentDecisions = deriveAgentDecisions(this.agentTrace);
            this.notify('agent');
          }
          this._applySavedExtras(saved);
          this.syncBlockBook();
        }
      } else if (saved?.world) {
        this._showSaved(saved);
      } else {
        await this.reset(this.seed);
      }
    } catch (error) {
      if (saved?.world) {
        this._showSaved(saved);
        this.set({ connected: false });
      } else {
        this.enterMock(error?.message || '后端未连接');
        console.warn('后端未连接，使用 Mock 数据：', error.message);
      }
    }
  },

  _canResume(live, saved) {
    const liveWorld = live?.world || live?.data?.world;
    const savedWorld = saved?.world;
    if (!liveWorld?.map || !savedWorld?.map) return false;
    if (liveWorld.map.width !== savedWorld.map.width || liveWorld.map.height !== savedWorld.map.height) return false;
    return (liveWorld.tick ?? 0) >= (savedWorld.tick ?? 0);
  },

  _isUntouchedServer(live) {
    const world = live?.world || live?.data?.world;
    if (!world?.map) return true;
    const orders = Object.keys(world.orders || {}).length;
    return world.map.width === 12 && world.map.height === 8 && (world.tick ?? 0) === 0 && orders === 0;
  },

  _showSaved(saved) {
    this.mockMode = false;
    this.applySnapshot({ world: saved.world, kpis: saved.kpis }, false);
    this.agentTrace = saved.agentTrace || [];
    this.agentDecisions = deriveAgentDecisions(this.agentTrace);
    this._applySavedExtras(saved);
    this.notify('agent');
  },

  _applySavedExtras(saved) {
    if (!saved) return;
    if (saved.blockBook) this.blockBook = saved.blockBook;
    if (Array.isArray(saved.sceneLog)) this.sceneLog = saved.sceneLog;
    if (Number.isFinite(saved.orderSurgeCount)) this.orderSurgeCount = saved.orderSurgeCount;
    this.orderSurge = !!saved.orderSurge;
    if (Array.isArray(saved.faultHandled)) this.faultHandled = new Set(saved.faultHandled);
    if (saved.metricsSeries?.utilization) this.metricsSeries = saved.metricsSeries;
    this.notify('world');
  },

  _saveSession() {
    if (this.mockMode || !this.world) return;
    const world = this.world;
    const payload = {
      world: { ...world, events: (world.events || []).slice(-100) },
      kpis: this.kpis,
      agentTrace: slimTrace(this.agentTrace),
      blockBook: this.blockBook,
      sceneLog: (this.sceneLog || []).slice(-30),
      orderSurgeCount: this.orderSurgeCount || 0,
      orderSurge: !!this.orderSurge,
      faultHandled: [...this.faultHandled],
      metricsSeries: this.metricsSeries,
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } catch {
      // 浏览器存满时保留内存中的当前仿真，不打断运行。
    }
  },

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveSession(), 400);
  },

  enterMock(reason) {
    this.mockMode = true;
    this.connected = false;
    this.lastError = reason || this.lastError;
    const snap = mockSnapshot(0);
    this.applySnapshot(snap, false);
    this.notify('state');
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

    if (this.mockMode) world.strategy = this.strategy;
    this.world = world;
    if (kpis) this.kpis = kpis;
    this.lastSeq = world.events?.at(-1)?.sequence ?? this.lastSeq;
    this._enrich();
    this._pushHistory(kpis || this.kpis);
    this.notify('world');
    this._scheduleSave();
  },

  _enrich() {
    if (!this.world) return;
    const robots = this.world.robots || {};
    const tick = this.world.tick ?? 0;
    this.zones = warehouseZones(this.world.map);
    this.congestion = deriveCongestion(this.world);
    if (this.mockMode) {
      this.extras = mockRobotExtras(robots, tick);
      this.extrasMode = 'mock';
      this.agentDecisions = mockAgentDecisions(tick);
      return;
    }
    this.extrasMode = 'live';
    this.extras = {};
    for (const robot of values(robots)) {
      this.extras[robot.id] = {
        utilization: tick > 0 ? (robot.busy_ticks || 0) / tick : null,
        avgTaskTime: null,
        history: null,
      };
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
    push(this.kpiHistory.avgTime, kpis.average_completion_ticks || 0);

    push(this.metricsSeries.throughput, kpis.throughput_per_100_ticks || 0);
    push(this.metricsSeries.avgTime, kpis.average_completion_ticks || 0);
    push(this.metricsSeries.utilization, (kpis.utilization || 0) * 100);
    push(this.metricsSeries.congestion, this.congestion.length);
    push(this.metricsSeries.fault, kpis.faulted_robots || 0);
    if (!this.mockMode && this.world) {
      const tick = this.world.tick ?? 0;
      const robots = this.metricsSeries.robots;
      for (const robot of values(this.world.robots)) {
        const key = String(robot.id);
        if (!robots[key]) robots[key] = [];
        const value = tick > 0 ? ((robot.busy_ticks || 0) / tick) * 100 : 0;
        push(robots[key], value);
      }
    }
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

  needsAgentDecision() {
    const robots = Object.values(this.world?.robots || {});
    const orders = Object.values(this.world?.orders || {});
    if (!robots.length) return true;
    for (const id of [...this.faultHandled]) {
      const robot = robots.find((item) => item.id === id);
      if (!robot || robot.state !== 'faulted') this.faultHandled.delete(id);
    }
    if (robots.some((robot) => robot.state === 'faulted' && !this.faultHandled.has(robot.id))) return true;
    const waiting = headOn(robots);
    if (waiting) return true;
    return robots.some((robot) => robot.state === 'idle') && orders.some((order) => order.state === 'pending');
  },

  modelEventName() {
    const robots = Object.values(this.world?.robots || {});
    const orders = Object.values(this.world?.orders || {});
    if (robots.some((robot) => robot.state === 'faulted' && !this.faultHandled.has(robot.id))) return '异常 Agent';
    if (headOn(robots)) return '路径 Agent';
    const pending = orders.some((order) => order.state === 'pending');
    const idle = robots.some((robot) => robot.state === 'idle');
    if (this.orderSurge && idle && pending) return '派单 Agent';
    return '';
  },

  async stepOnce() {
    if (this.stepping) return;
    this.stepping = true;
    const decide = !this.mockMode && this.backend === 'agent' && this.needsAgentDecision();
    if (decide) this.set({ deciding: true, decideStarted: Date.now() });
    try {
      if (this.mockMode) {
        const snap = mockSnapshot((this.world?.tick ?? 0) + 1);
        this.applySnapshot(snap, true);
      } else if (decide) {
        const result = await api.agentDecide(1, { surge: this.orderSurge });
        if (result.turn?.trigger?.type === 'order_surge') this.orderSurge = false;
        this.applySnapshot(result, true);
        if (result.turn?.trigger?.type === 'fault') {
          for (const robot of Object.values(result.world?.robots || {})) {
            if (robot.state === 'faulted') this.faultHandled.add(robot.id);
          }
        }
        await this.refreshAgent();
      } else if (this.backend === 'agent') {
        await api.command({ op: 'step', ticks: 1 });
        this.applySnapshot(await api.getState(), true);
      } else {
        await api.command({ op: 'step', ticks: 1 });
        if (!this.connected) await this.reload();
      }
    } catch (error) {
      this.lastError = error?.message || String(error);
      this.stopPlay();
      this.notify('error', error);
    } finally {
      this.stepping = false;
      if (decide) this.set({ deciding: false });
    }
  },

  async reload() {
    try {
      const payload = await api.getState();
      this.applySnapshot(payload, false);
      this.set({ connected: true });
    } catch (error) {
      this.lastError = error?.message || String(error);
      this.set({ connected: false });
      throw error;
    }
  },

  startPlay() {
    this.set({ playing: true });
    const loop = () => {
      if (!this.playing) return;
      this.stepOnce().finally(() => {
        if (!this.playing) return;
        const gap = this.backend === 'agent' ? this.stepInterval() * 0.45 : this.stepInterval();
        this._timer = setTimeout(loop, gap);
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
    clearTimeout(this._saveTimer);
    localStorage.removeItem(SESSION_KEY);
    this.scenario = null;
    this.hiddenSeq = 0;
    this.headings = new Map();
    this.kpiHistory = { utilization: [], throughput: [], wait: [], pending: [], avgTime: [] };
    this.metricsSeries = { throughput: [], avgTime: [], utilization: [], congestion: [], fault: [], robots: {} };
    this.agentDecisions = [];
    this.faultHandled = new Set();
    this.orderSurge = false;
    this.orderSurgeCount = 0;
    this.sceneLog = [];
    this.agentTrace = [];
    this.blockBook = { points: [], segments: [] };
    this.segmentPick = null;
    this.orderDraft = null;
    this.notify('pick');
    this.candidateEval = null;
    this.seed = normalizeSeed(seed);
    this._savePrefs();
    if (this.mockMode) {
      this.applySnapshot(mockSnapshot(0), false);
      return;
    }
    const strategy = this.strategy;
    const result = await api.resetWorld({ seed: this.seed, map, robots });
    this.applySnapshot(result, false);
    this.strategy = strategy;
    if (this.backend === 'sim') await api.command({ op: 'set_strategy', strategy });
    if (this.autoOrders && this.orderCount > 0) {
      await api.command({ op: 'generate_orders', count: this.orderCount });
      if (this.backend === 'agent') await this.reload();
    }
    await this.refreshAgent();
  },

  async setStrategy(strategy) {
    this.strategy = strategy;
    this._savePrefs();
    if (this.mockMode) {
      if (this.world) this.world.strategy = strategy;
      this.notify('world');
      return;
    }
    await api.command({ op: 'set_strategy', strategy });
  },

  beginOrderDraft() {
    this.cancelSegmentPick();
    this._orderDraftSeq = (this._orderDraftSeq || 0) + 1;
    this.orderDraft = { seq: this._orderDraftSeq, count: 1, pickup: null, dropoff: null, aim: 'pickup' };
    this.notify('pick');
    if ((location.hash || '#/') !== '#/') location.hash = '/';
  },

  cancelOrderDraft() {
    if (!this.orderDraft) return;
    this.orderDraft = null;
    this.notify('pick');
  },

  aimOrderDraft(which) {
    if (!this.orderDraft) return;
    const aim = which === 'dropoff' ? 'dropoff' : 'pickup';
    if (this.orderDraft.aim === aim) return;
    this.orderDraft.aim = aim;
    this.notify('pick');
  },

  takeOrderPoint(x, y) {
    if (!this.orderDraft) return;
    const point = this._orderCell(x, y);
    if (!point) return;
    const aim = this.orderDraft.aim === 'dropoff' ? 'dropoff' : 'pickup';
    this.orderDraft[aim] = point;
    this.orderDraft.aim = 'dropoff';
    this.notify('pick');
  },

  setOrderDraftPoint(which, x, y) {
    if (!this.orderDraft) return false;
    const point = this._orderCell(x, y);
    if (!point) return false;
    const key = which === 'dropoff' ? 'dropoff' : 'pickup';
    this.orderDraft[key] = point;
    this.orderDraft.aim = key === 'pickup' ? 'dropoff' : 'pickup';
    this.notify('pick');
    return true;
  },

  _orderCell(x, y) {
    const map = this.world?.map;
    if (!map) {
      this.notify('error', new Error('地图还没有加载'));
      return null;
    }
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      this.notify('error', new Error('坐标需要是整数'));
      return null;
    }
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
      this.notify('error', new Error(`坐标要在 0–${map.width - 1} 和 0–${map.height - 1} 之间`));
      return null;
    }
    if ((map.obstacles || []).some((point) => point.x === x && point.y === y)) {
      this.notify('error', new Error('这一格是货架，请改到通道上'));
      return null;
    }
    if ((map.blocked || []).some((point) => point.x === x && point.y === y)) {
      this.notify('error', new Error('这一格已经封锁，不能作为取送点'));
      return null;
    }
    return { x, y };
  },

  async createDraftOrders() {
    const draft = this.orderDraft;
    if (!draft) return;
    const count = Math.floor(Number(draft.count));
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('订单数要在 1 到 100 之间');
    if (!draft.pickup || !draft.dropoff) throw new Error('请先定好取货点和送货点');
    if (draft.pickup.x === draft.dropoff.x && draft.pickup.y === draft.dropoff.y) throw new Error('取货点和送货点需要是不同的格子');
    if (this.mockMode) throw new Error('演示模式不能创建订单');
    const pickup = { ...draft.pickup };
    const dropoff = { ...draft.dropoff };
    let created = 0;
    try {
      for (let i = 0; i < count; i += 1) {
        await api.command({ op: 'add_order', pickup, dropoff, priority: 0 });
        created += 1;
      }
    } catch (error) {
      if (created && this.backend === 'agent') await this.reload();
      if (created) {
        this.orderDraft = null;
        this.notify('pick');
        throw new Error(`已创建 ${created} 个，后面的没有创建：${error.message}`);
      }
      throw error;
    }
    this.orderDraft = null;
    this.notify('pick');
    if (this.backend === 'agent') await this.reload();
    this.notify('toast', `已创建 ${created} 个订单，取货 (${pickup.x}, ${pickup.y})，送货 (${dropoff.x}, ${dropoff.y})`);
  },

  async generateOrders(count = this.orderCount) {
    const n = normalizeCount(count);
    if (this.mockMode) throw new Error('演示模式不能调用订单生成接口');
    await api.command({ op: 'generate_orders', count: n });
    if (this.backend === 'agent') await this.reload();
  },

  async dispatch() {
    if (this.mockMode) throw new Error('演示模式不能派单');
    await api.command({ op: 'dispatch' });
    if (this.backend === 'agent') await this.reload();
  },

  // 手动派单：把指定待分配订单分配给指定空闲机器人
  async assignOrder(robotId, orderId) {
    if (this.mockMode) throw new Error('演示模式不支持手动派单');
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
  async injectSceneEvent(key, detail = {}) {
    if (this.mockMode) {
      this.notify('toast', '演示模式不能注入到仿真核心');
      return;
    }
    let message = '场景事件已注入';
    if (key === 'robot_fault') {
      const robotId = Number(detail.robotId);
      if (!robotId) throw new Error('请选择要故障的机器人');
      await api.command({ op: 'inject_fault', robot_id: robotId });
      this.faultHandled.delete(robotId);
    } else if (key === 'robot_repair') {
      const robotId = Number(detail.robotId);
      if (!robotId) throw new Error('请选择要修复的机器人');
      await api.command({ op: 'repair_robot', robot_id: robotId });
      this.faultHandled.delete(robotId);
    } else if (key === 'order_burst') {
      const count = Math.max(1, Math.min(40, Number(detail.count) || 8));
      await api.command({ op: 'generate_orders', count });
      this.orderSurge = true;
      this.orderSurgeCount += 1;
      message = `已新增 ${count} 个订单`;
    } else if (key === 'point_block') {
      const x = Number(detail.x);
      const y = Number(detail.y);
      const problem = this._floorProblem(x, y);
      if (problem) throw new Error(problem);
      await api.command({ op: 'set_blocked', position: { x, y }, blocked: true });
      this.blockBook.points.push({ x, y });
      message = `已封锁 (${x}, ${y})`;
    } else if (key === 'segment_block') {
      const span = this._segmentSpan(detail.start, detail.end);
      const occupied = new Set(values(this.world?.robots || {}).map((robot) => `${robot.position.x},${robot.position.y}`));
      const already = new Set((this.world?.map?.blocked || []).map((point) => `${point.x},${point.y}`));
      const fresh = span.filter((cell) => !occupied.has(`${cell.x},${cell.y}`) && !already.has(`${cell.x},${cell.y}`));
      const kept = span.filter((cell) => already.has(`${cell.x},${cell.y}`));
      if (!fresh.length && !kept.length) throw new Error('这条路上没有可封锁的空格');
      const blockedNow = [];
      let failed = null;
      for (const cell of fresh) {
        try {
          await api.command({ op: 'set_blocked', position: cell, blocked: true });
          blockedNow.push(cell);
        } catch (error) {
          failed = error;
          break;
        }
      }
      const cells = [...kept, ...blockedNow];
      if (cells.length) this._rememberSegment(detail.start, detail.end, cells);
      if (failed) {
        if (this.backend === 'agent') await this.reload();
        this.syncBlockBook();
        throw failed;
      }
      const skipped = span.length - cells.length;
      message = `已封锁 (${detail.start.x}, ${detail.start.y}) → (${detail.end.x}, ${detail.end.y})，共 ${cells.length} 格`;
      if (skipped > 0) message += `，${skipped} 格上有机器人，已跳过`;
    } else if (key === 'road_restore') {
      this.syncBlockBook();
      if (detail.kind === 'point') {
        const x = Number(detail.x);
        const y = Number(detail.y);
        const known = this.blockBook.points.some((point) => point.x === x && point.y === y);
        if (!known) throw new Error('这个单点当前没有封锁');
        await api.command({ op: 'set_blocked', position: { x, y }, blocked: false });
        this.blockBook.points = this.blockBook.points.filter((point) => !(point.x === x && point.y === y));
        message = `已恢复 (${x}, ${y})`;
      } else if (detail.kind === 'segment') {
        const segment = this.blockBook.segments.find((item) => item.id === detail.id);
        if (!segment) throw new Error('这条路段当前没有封锁');
        for (const cell of segment.cells) {
          await api.command({ op: 'set_blocked', position: cell, blocked: false });
        }
        this.blockBook.segments = this.blockBook.segments.filter((item) => item.id !== detail.id);
        message = `已恢复 ${segment.label}`;
      } else {
        throw new Error('请选择要恢复的封锁');
      }
    } else {
      throw new Error('未知场景事件');
    }
    this.sceneLog = this.sceneLog || [];
    this.sceneLog.push({ key, message, tick: this.world?.tick ?? 0 });
    if (this.sceneLog.length > 30) this.sceneLog.shift();
    if (this.backend === 'agent') await this.reload();
    this.syncBlockBook();
    this._scheduleSave();
    this.notify('toast', message);
  },

  syncBlockBook() {
    const live = new Set((this.world?.map?.blocked || []).map((point) => `${point.x},${point.y}`));
    const keyOf = (point) => `${point.x},${point.y}`;
    this.blockBook.points = this.blockBook.points.filter((point) => live.has(keyOf(point)));
    this.blockBook.segments = this.blockBook.segments
      .map((segment) => ({ ...segment, cells: segment.cells.filter((point) => live.has(keyOf(point))) }))
      .filter((segment) => segment.cells.length);
    const known = new Set(this.blockBook.points.map(keyOf));
    for (const segment of this.blockBook.segments) {
      for (const point of segment.cells) known.add(keyOf(point));
    }
    for (const point of this.world?.map?.blocked || []) {
      if (!known.has(keyOf(point))) this.blockBook.points.push({ x: point.x, y: point.y });
    }
  },

  _rememberSegment(start, end, cells) {
    const seen = new Set(cells.map((point) => `${point.x},${point.y}`));
    const unique = [...seen].map((key) => {
      const [cx, cy] = key.split(',').map(Number);
      return { x: cx, y: cy };
    });
    this.blockBook.points = this.blockBook.points.filter((point) => !seen.has(`${point.x},${point.y}`));
    this.blockBook.segments = this.blockBook.segments
      .map((segment) => ({ ...segment, cells: segment.cells.filter((point) => !seen.has(`${point.x},${point.y}`)) }))
      .filter((segment) => segment.cells.length);
    this.blockBook.segments.push({
      id: `${start.x},${start.y}-${end.x},${end.y}-${Date.now()}`,
      label: `(${start.x}, ${start.y}) → (${end.x}, ${end.y})`,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      cells: unique,
    });
  },

  _segmentSpan(start, end) {
    const ax = Number(start?.x);
    const ay = Number(start?.y);
    const bx = Number(end?.x);
    const by = Number(end?.y);
    if (![ax, ay, bx, by].every(Number.isInteger)) throw new Error('请在地图上选择起点和终点');
    if (ax === bx && ay === by) throw new Error('请再点一个不同的终点');
    if (ax !== bx && ay !== by) throw new Error('起点和终点要在同一条横向或纵向通道上');
    const map = this.world?.map;
    if (!map) throw new Error('地图还没有加载');
    const shelf = new Set((map.obstacles || []).map((point) => `${point.x},${point.y}`));
    const cells = [];
    if (ax === bx) {
      const [y0, y1] = ay < by ? [ay, by] : [by, ay];
      for (let y = y0; y <= y1; y += 1) cells.push({ x: ax, y });
    } else {
      const [x0, x1] = ax < bx ? [ax, bx] : [bx, ax];
      for (let x = x0; x <= x1; x += 1) cells.push({ x, y: ay });
    }
    if (cells.some((cell) => shelf.has(`${cell.x},${cell.y}`))) {
      throw new Error('这两点之间有货架，请改点同一条通道上的两个位置');
    }
    return cells;
  },

  beginSegmentPick() {
    this.cancelOrderDraft();
    this.segmentPick = { start: null };
    this.notify('pick');
  },

  cancelSegmentPick() {
    if (!this.segmentPick) return;
    this.segmentPick = null;
    this.notify('pick');
  },

  takeSegmentPoint(x, y) {
    if (!this.segmentPick) return;
    const shelf = (this.world?.map?.obstacles || []).some((point) => point.x === x && point.y === y);
    if (shelf) {
      this.notify('error', new Error('请点在通道上，不要点在货架上'));
      return;
    }
    if (!this.segmentPick.start) {
      this.segmentPick = { start: { x, y } };
      this.notify('pick');
      return;
    }
    const start = this.segmentPick.start;
    const end = { x, y };
    try {
      this._segmentSpan(start, end);
    } catch (error) {
      this.notify('error', error);
      return;
    }
    this.segmentPick = null;
    this.notify('pick');
    this.injectSceneEvent('segment_block', { start, end }).catch((error) => this.notify('error', error));
  },

  _floorProblem(x, y) {
    const map = this.world?.map;
    if (!map || !Number.isInteger(x) || !Number.isInteger(y)) return '坐标需要是整数';
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return `坐标要在 0–${map.width - 1} 和 0–${map.height - 1} 之间`;
    if ((map.obstacles || []).some((point) => point.x === x && point.y === y)) return '这一格是货架，不能封锁';
    if (values(this.world?.robots || {}).some((robot) => robot.position?.x === x && robot.position?.y === y)) return '这一格上有机器人，不能封锁';
    if ((map.blocked || []).some((point) => point.x === x && point.y === y)) return '这一格已经封锁';
    return '';
  },

  async refreshAgent() {
    if (this.backend !== 'agent') return;
    try {
      const trace = await api.agentTrace();
      this.agentTrace = trace || [];
      this.agentDecisions = deriveAgentDecisions(this.agentTrace);
      this.agentStatus = await api.agentStatus().catch(() => ({}));
      this.notify('agent');
      this._scheduleSave();
    } catch {
      /* 忽略 */
    }
  },

  select(sel) {
    if (this.segmentPick && sel?.kind === 'segment') {
      this.takeSegmentPoint(sel.x, sel.y);
      return;
    }
    if (this.orderDraft && sel?.kind === 'order-point') {
      this.takeOrderPoint(sel.x, sel.y);
      return;
    }
    this.selected = sel;
    this.notify('select');
  },

  requestFocus(sel) {
    this.selected = sel;
    this.focusRequest = sel;
    this.notify('select');
    const path = `${location.pathname}${location.search}#/`;
    if ((location.hash || '#/') !== '#/') location.hash = '/';
    else this.notify('focus');
    return path;
  },

  clearEventLog() {
    this.hiddenSeq = this.lastSeq || 0;
    this.notify('world');
  },

  visibleEvents() {
    return (this.world?.events || []).filter((event) => (event.sequence || 0) > (this.hiddenSeq || 0));
  },

  // 用现有 plan_path 评估空闲机器人到取货点的地图距离。不写入仿真状态。
  async evaluateCandidates(orderId) {
    if (this.mockMode) {
      throw new Error('演示模式不能调用 plan_path');
    }
    const order = this.world?.orders?.[orderId];
    if (!order) throw new Error('订单不存在');
    const idle = values(this.world?.robots || {}).filter((robot) => robot.state === 'idle');
    const rows = [];
    for (const robot of idle) {
      try {
        const result = await api.command({
          op: 'plan_path',
          start: robot.position,
          goal: order.pickup,
        });
        const data = result.data || result;
        rows.push({
          robotId: robot.id,
          position: robot.position,
          completed: robot.completed_orders ?? 0,
          distance: Number.isFinite(data.distance) ? data.distance : null,
          reachable: Number.isFinite(data.distance),
        });
      } catch (error) {
        rows.push({
          robotId: robot.id,
          position: robot.position,
          completed: robot.completed_orders ?? 0,
          distance: null,
          reachable: false,
          error: error.message,
        });
      }
    }
    rows.sort((a, b) => {
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      const penalty = (row) => (this.strategy === 'balanced' ? row.completed * 4 : 0);
      return (a.distance + penalty(a)) - (b.distance + penalty(b));
    });
    this.candidateEval = {
      orderId,
      tick: this.world?.tick ?? 0,
      strategy: this.strategy,
      rows,
    };
    this.notify('agent');
    return this.candidateEval;
  },

  setToggle(key, value) {
    this.toggles[key] = value;
    this._savePrefs();
    this.notify('toggle');
  },
  setProjection(mode) {
    this.projection = mode;
    this._savePrefs();
    this.notify('projection');
  },

  resetDisplay() {
    this.theme = 'light';
    this.density = 'comfortable';
    this.projection = 'iso';
    this.toggles = { ...DEFAULT_TOGGLES };
    this.applyChrome();
    this._savePrefs();
    this.notify('theme');
    this.notify('projection');
    this.notify('toggle');
  },
};

// 由真实 Agent trace 派生结构化决策；无 trace 时返回空（不伪造）。
// 兼容两种结构：单 Agent（rule/llm 工具调用数组）与多 Agent（agents.mjs 的 3 个 Agent 结果）。
function loadSession() {
  try {
    const data = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!data?.world?.map || !data.world.robots) return null;
    return data;
  } catch {
    return null;
  }
}

function slimAction(item) {
  return { name: item.name, arguments: item.arguments || {}, role: item.role };
}

function slimTrace(trace) {
  return (trace || []).slice(-40).map((turn) => {
    const actions = turn?.actions || [];
    const multi = actions.length > 0 && actions[0] && ('agent' in actions[0] || Array.isArray(actions[0].actions));
    return {
      tick: turn?.tick,
      mode: turn?.mode,
      trigger: turn?.trigger || null,
      explanation: turn?.explanation || '',
      actions: multi
        ? actions.map((block) => ({
          agent: block.agent,
          name: block.name,
          report: block.report,
          trigger: block.trigger,
          explanation: block.explanation,
          actions: (block.actions || []).filter((item) => item && item.name && item.name !== 'step').map(slimAction),
        }))
        : actions.filter((item) => item && item.name && item.name !== 'step').map(slimAction),
    };
  });
}

function deriveAgentDecisions(trace) {
  if (!trace || !trace.length) return [];
  return trace.slice(-8).reverse().map((turn) => {
    const actions = turn.actions || [];
    const isMulti = actions.length > 0 && actions[0] && 'agent' in actions[0];
    if (isMulti) {
      const trigger = turn.trigger || actions.find((item) => item.trigger)?.trigger || null;
      const explanation = turn.explanation || actions.find((item) => item.explanation)?.explanation || '';
      return {
        tick: turn.tick,
        multi: true,
        trigger,
        title: trigger?.title || turn.explanation || 'Agent 决策',
        detail: trigger?.detail || '',
        explanation,
        agents: actions.map((item) => ({
          id: item.agent,
          name: item.name || item.agent,
          report: item.report || item.explanation || '',
          actions: (item.actions || [])
            .filter((entry) => entry && (entry.role === 'tool' || entry.name) && entry.name !== 'step')
            .map((entry) => `${entry.name}(${JSON.stringify(entry.arguments || {})})`),
        })),
      };
    }
    return {
      tick: turn.tick,
      multi: false,
      title: turn.explanation || '规则策略决策',
      steps: actions.map((a) => (a && typeof a === 'object' ? a.name || a.role : String(a))),
      reasons: turn.explanation ? [turn.explanation] : [],
    };
  });
}
