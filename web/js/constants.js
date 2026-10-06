// 领域常量：状态/事件标签、语义色、默认地图、导航与页面元数据

export const STATE_LABEL = {
  idle: '空闲',
  to_pickup: '取货途中',
  to_dropoff: '送货途中',
  faulted: '故障',
  pending: '待分配',
  assigned: '已分配',
  in_transit: '运输中',
  completed: '已完成',
};

export const EVENT_LABEL = {
  order_created: '订单创建',
  order_assigned: '订单分配',
  order_picked_up: '完成取货',
  order_completed: '订单完成',
  path_replanned: '路径重规划',
  map_changed: '地图变更',
  robot_faulted: '机器人故障',
  robot_repaired: '机器人修复',
  robot_waiting: '等待绕行',
};

// 状态 → 语义色。绿色=运行/完成，蓝色=信息，橙色=等待，红色=故障。
export const STATE_COLOR = {
  idle: '#64748B',
  to_pickup: '#0D9488',
  to_dropoff: '#0D9488',
  faulted: '#EF4444',
  pending: '#F59E0B',
  assigned: '#3B82F6',
  in_transit: '#0D9488',
  completed: '#16A34A',
};

// 路径按机器人编号区分，不与状态色混用。
export const PATH_COLORS = ['#0D9488', '#3B82F6', '#D97706', '#7C3AED', '#DB2777', '#0284C7', '#16A34A', '#EA580C'];

export function robotPathColor(id) {
  const n = Number(id) || 1;
  return PATH_COLORS[(n - 1) % PATH_COLORS.length];
}

// 机器人可视化状态色（含「等待」）
export function robotStatusColor(robot) {
  if (!robot) return '#64748B';
  if (robot.state === 'faulted') return '#EF4444';
  if (robot.state === 'idle') return '#64748B';
  const moving = robot.state === 'to_pickup' || robot.state === 'to_dropoff';
  if (moving && (robot.wait_ticks || 0) > 0) return '#F59E0B';
  return '#0D9488';
}

export const EVENT_TONE = {
  robot_faulted: 'fault',
  order_completed: 'info',
  robot_waiting: 'warn',
  path_replanned: 'warn',
  map_changed: 'warn',
};

// 默认地图：24×16，5 组双深货架（竖排），两侧与货架之间留通道
const RACK_COLUMNS = [3, 4, 7, 8, 11, 12, 15, 16, 19, 20];
const RACK_ROWS = Array.from({ length: 12 }, (_, i) => i + 2); // y=2..13
export const DEFAULT_MAP = {
  width: 24,
  height: 16,
  obstacles: RACK_COLUMNS.flatMap((x) => RACK_ROWS.map((y) => ({ x, y }))),
  blocked: [],
};

export const DEFAULT_ROBOTS = [
  { x: 1, y: 2 },
  { x: 0, y: 6 },
  { x: 2, y: 9 },
  { x: 1, y: 12 },
  { x: 0, y: 14 },
];

// 导航与页面元数据
export const NAV_ITEMS = [
  { route: '/', key: 'dashboard', label: '总览', sub: '仓库运行状态' },
  { route: '/robots', key: 'robots', label: '机器人管理', sub: '状态与任务' },
  { route: '/orders', key: 'orders', label: '订单调度', sub: '查询与分配' },
  { route: '/agent', key: 'agent', label: 'Agent 决策', sub: '调度过程' },
  { route: '/analytics', key: 'analytics', label: '数据分析', sub: '运行效果' },
  { route: '/settings', key: 'settings', label: '系统设置', sub: '参数与连接' },
];

export const PAGE_META = {
  dashboard: { title: '总览', sub: '仓库运行状态与数字孪生' },
  robots: { title: '机器人管理', sub: '每台机器人的状态、任务与路径' },
  orders: { title: '订单调度', sub: '订单查询、进度与分配' },
  agent: { title: 'Agent决策', sub: '候选对比、路径与决策记录' },
  analytics: { title: '数据分析', sub: '本次运行的指标与趋势' },
  settings: { title: '系统设置', sub: '仿真参数、地图显示与连接' },
};

// 仿真速度档位（倍率）
export const SPEED_STEPS = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '4x', value: 4 },
];

// 策略列表
export const STRATEGIES = [
  { value: 'nearest', label: 'nearest 最近优先' },
  { value: 'balanced', label: 'balanced 工作量均衡' },
  { value: 'manual', label: 'manual Agent 接管' },
];

// 可注入场景事件
export const SCENE_EVENTS = [
  { key: 'robot_fault', label: '机器人故障', tone: 'fault', desc: '指定一台机器人故障并停在原地，不会自动修复' },
  { key: 'robot_repair', label: '修复故障', tone: 'info', desc: '指定一台已经故障的机器人，手动让它恢复' },
  { key: 'point_block', label: '单点封锁', tone: 'warn', desc: '填写障碍坐标 x 和 y，只封锁这一格' },
  { key: 'order_burst', label: '订单突发', tone: 'info', desc: '按你填的数量新增一批订单' },
  { key: 'segment_block', label: '路段封锁', tone: 'warn', desc: '在地图上依次点击起点和终点，封锁这条路上的格子' },
  { key: 'road_restore', label: '道路恢复', tone: 'info', desc: '从已经封锁的单点坐标和路段中选择一处恢复通行' },
];
