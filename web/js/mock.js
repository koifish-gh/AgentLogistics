// Mock / 派生数据层
// 后端未提供的数据（历史利用率、Agent 结构化决策、策略对比、
// 拥堵/故障区域等）统一在此生成，UI 不直接硬编码。
// 未来后端补齐后，仅替换此模块为真实数据源即可。

import { DEFAULT_MAP, DEFAULT_ROBOTS } from './constants.js';

// 简单的确定性伪随机（便于稳定展示）
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 无货架的「自由列」（垂直通道），机器人沿这些列上下往返，绝不经过货架
function freeColumns(map) {
  const cols = [];
  for (let x = 0; x < map.width; x += 1) {
    if (!map.obstacles.some((p) => p.x === x)) cols.push(x);
  }
  return cols;
}

// 机器人沿自由列上下往返的「动画快照」：用于后端未连接时的 Mock 展示
function robotLoop(id, tick) {
  const map = DEFAULT_MAP;
  const cols = freeColumns(map);
  const x = cols[(id - 1) % cols.length];
  const yMin = 1;
  const yMax = map.height - 2;
  const span = yMax - yMin;
  const period = 2 * span;
  const t = ((tick + id * 5) % period + period) % period;
  const phase = t < span ? t : period - t;
  return { x, y: yMin + Math.round(phase) };
}

function mockRobot(id, tick) {
  const pos = robotLoop(id, tick);
  const rnd = seeded(id * 31 + tick);
  const state = id === 3 && tick % 60 > 40 ? 'faulted' : (rnd() < 0.5 ? 'to_pickup' : 'to_dropoff');
  const orderId = id === 3 && state === 'faulted' ? null : id + ((tick / 20) | 0);
  return {
    id,
    position: pos,
    state,
    order_id: orderId,
    path: state === 'faulted' ? [] : [{ x: pos.x, y: Math.min(pos.y + 1, DEFAULT_MAP.height - 1) }],
    distance: tick * 2 + id,
    busy_ticks: tick - id,
    wait_ticks: state === 'to_pickup' && tick % 7 === 0 ? 2 : 0,
    consecutive_waits: 0,
    completed_orders: (tick / 18 + id) | 0,
  };
}

export function mockSnapshot(tick = 0) {
  const map = DEFAULT_MAP;
  const robots = {};
  for (const r of DEFAULT_ROBOTS) {
    const id = DEFAULT_ROBOTS.indexOf(r) + 1;
    robots[id] = mockRobot(id, tick);
  }
  const rnd = seeded(42);
  const orders = {};
  for (let i = 1; i <= 8; i += 1) {
    const done = i <= Math.floor(tick / 15);
    orders[i] = {
      id: i,
      pickup: { x: i % 3, y: (i * 3) % map.height },
      dropoff: { x: map.width - 2 + (i % 2), y: (i * 5) % map.height },
      priority: i % 10,
      state: done ? 'completed' : i % 3 === 0 ? 'in_transit' : i % 2 === 0 ? 'assigned' : 'pending',
      robot_id: done ? (i % 3) + 1 : i % 2 === 0 ? (i % 3) + 1 : null,
      created_at: Math.max(0, tick - 20 + i),
      completed_at: done ? tick - i : null,
      recovery_from: null,
    };
  }

  // 热力图（占用）：主通道更热
  const aisleCols = new Set(freeColumns(map));
  const heatmap = [];
  for (let y = 0; y < map.height; y += 1) {
    const row = [];
    for (let x = 0; x < map.width; x += 1) {
      const isShelf = map.obstacles.some((p) => p.x === x && p.y === y);
      let heat = 0;
      if (!isShelf) {
        const aisle = aisleCols.has(x) || y <= 1 || y >= map.height - 2;
        heat = aisle ? 3 + Math.floor(rnd() * 9) : Math.floor(rnd() * 2);
      }
      row.push(heat);
    }
    heatmap.push(row);
  }

  const totalOrders = Object.keys(orders).length;
  const completed = Math.min(totalOrders, Math.floor(tick / 15));
  for (const order of Object.values(orders)) {
    const done = order.id <= completed;
    order.state = done ? 'completed' : order.id === completed + 1 ? 'in_transit' : order.id === completed + 2 ? 'assigned' : 'pending';
    order.robot_id = done || order.state === 'in_transit' || order.state === 'assigned' ? ((order.id - 1) % 5) + 1 : null;
    order.completed_at = done ? Math.max(order.created_at, tick - order.id) : null;
    if (order.robot_id && robots[order.robot_id]?.state === 'faulted') {
      order.state = 'pending';
      order.robot_id = null;
      order.completed_at = null;
    }
  }
  const pending = Object.values(orders).filter((order) => order.state === 'pending').length;
  const active = Object.values(orders).filter((order) => order.state === 'assigned' || order.state === 'in_transit').length;
  const events = [];
  let sequence = 1;
  for (const order of Object.values(orders)) {
    events.push({ sequence: sequence++, tick: order.created_at, kind: 'order_created', robot_id: null, order_id: order.id, detail: `创建订单 #${order.id}` });
    if (order.state === 'assigned' || order.state === 'in_transit' || order.state === 'completed') {
      events.push({ sequence: sequence++, tick: order.created_at, kind: 'order_assigned', robot_id: order.robot_id, order_id: order.id, detail: `R${order.robot_id} 接收订单` });
    }
    if (order.state === 'in_transit' || order.state === 'completed') {
      events.push({ sequence: sequence++, tick: Math.max(order.created_at, tick), kind: 'order_picked_up', robot_id: order.robot_id, order_id: order.id, detail: `完成取货 #${order.id}` });
    }
    if (order.state === 'completed') {
      events.push({ sequence: sequence++, tick: order.completed_at ?? tick, kind: 'order_completed', robot_id: order.robot_id, order_id: order.id, detail: `完成订单 #${order.id}` });
    }
  }

  const world = {
    tick,
    strategy: 'balanced',
    map,
    robots,
    orders,
    events,
    heatmap,
  };

  const kpis = {
    tick,
    total_orders: totalOrders,
    completed_orders: completed,
    pending_orders: pending,
    active_orders: active,
    faulted_robots: robots[3]?.state === 'faulted' ? 1 : 0,
    throughput_per_100_ticks: tick > 0 ? (completed / tick) * 100 : 0,
    average_completion_ticks: completed > 0 ? 32 + (tick % 10) / 10 : 0,
    utilization: completed > 0 ? 0.86 + (tick % 5) / 100 : 0,
    total_distance: tick * 4 + 20,
    total_wait_ticks: tick > 0 ? Math.floor(tick / 6) : 0,
  };

  return { world, kpis };
}

// 机器人扩展指标（后端未提供）：利用率 / 平均任务时间 / 历史曲线
export function mockRobotExtras(robots, tick) {
  const extras = {};
  for (const robot of Object.values(robots)) {
    const rnd = seeded(robot.id * 53 + 7);
    const history = Array.from({ length: 24 }, (_, i) => 0.4 + 0.5 * Math.abs(Math.sin(i / 5 + robot.id + tick / 20)) + rnd() * 0.08);
    extras[robot.id] = {
      utilization: 0.55 + 0.4 * Math.abs(Math.sin(robot.id + tick / 30)),
      avgTaskTime: 26 + (robot.id % 5) * 4,
      history,
    };
  }
  return extras;
}

// Agent 结构化决策（Mock，独立数据层；后端 trace 存在时优先用真实 trace 派生）
export function mockAgentDecisions(tick) {
  return [
    {
      tick: Math.max(0, tick - 4),
      title: '订单突发 #13',
      robotId: 3,
      steps: ['分析机器人负载', '评估路径与拥堵', '选择机器人 R3', '生成执行方案'],
      reasons: ['当前负载最低', '与取货点距离较近', '当前路径无拥堵', '不会影响其他订单'],
    },
    {
      tick: Math.max(0, tick - 11),
      title: '通道拥堵 A 通道',
      robotId: 2,
      steps: ['检测到等待事件', '评估替代路径', '重规划路径', '继续执行'],
      reasons: ['原路径存在对向占用', '替代路径代价更低'],
    },
  ];
}

// 策略对比（仅展示数据，不做主观评分）
export function mockStrategyComparison() {
  return [
    { strategy: 'Balanced', throughput: 16.7, avgTime: 32.6, utilization: 0.889, congestion: 6 },
    { strategy: 'Distance', throughput: 17.9, avgTime: 28.4, utilization: 0.912, congestion: 9 },
  ];
}

// 仓库分区（前端可视化概念）：取货区 = 左侧走道，送货区 = 右侧走道
export function warehouseZones(map) {
  const pickup = [];
  const dropoff = [];
  const shelfSet = new Set((map.obstacles || []).map((p) => `${p.x},${p.y}`));
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (shelfSet.has(`${x},${y}`)) continue;
      if (x < 2) pickup.push({ x, y });
      else if (x >= map.width - 2) dropoff.push({ x, y });
    }
  }
  return { pickup, dropoff };
}

// 由热力图派生拥堵区域（占用高于阈值的连通格子）
export function deriveCongestion(world, threshold = 7) {
  const map = world.map;
  const zones = [];
  const visited = new Set();
  const shelfSet = new Set((map.obstacles || []).map((p) => `${p.x},${p.y}`));
  const flood = (x, y) => {
    const stack = [[x, y]];
    const cells = [];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const key = `${cx},${cy}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) continue;
      if (shelfSet.has(key)) continue;
      const heat = world.heatmap?.[cy]?.[cx] ?? 0;
      if (heat < threshold) continue;
      cells.push({ x: cx, y: cy });
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return cells;
  };
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const key = `${x},${y}`;
      if (visited.has(key) || shelfSet.has(key)) continue;
      if ((world.heatmap?.[y]?.[x] ?? 0) >= threshold) {
        const cells = flood(x, y);
        if (cells.length >= 2) zones.push({ cells, level: 1 });
      }
    }
  }
  return zones;
}
