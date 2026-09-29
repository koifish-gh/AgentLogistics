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

// 状态 → 语义色：颜色表达「状态」而非「机器人编号」
export const STATE_COLOR = {
  idle: '#8b9aa8',
  to_pickup: '#2cc6b0',
  to_dropoff: '#2cc6b0',
  faulted: '#ff6b7a',
  pending: '#f0b34a',
  assigned: '#2cc6b0',
  in_transit: '#2cc6b0',
  completed: '#7d8ea3',
};

// 机器人可视化状态色（含「等待」）
export function robotStatusColor(robot) {
  if (robot.state === 'faulted') return '#ff6b7a';
  if (robot.state === 'idle') return '#8b9aa8';
  const moving = robot.state === 'to_pickup' || robot.state === 'to_dropoff';
  if (moving && (robot.wait_ticks || 0) > 0) return '#f0b34a';
  return '#2cc6b0';
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
  { route: '/', key: 'dashboard', label: '总览', sub: '实时监控' },
  { route: '/robots', key: 'robots', label: '机器人管理', sub: '状态与详情' },
  { route: '/orders', key: 'orders', label: '订单调度', sub: '管理与派单' },
  { route: '/analytics', key: 'analytics', label: '数据分析', sub: '趋势与对比' },
  { route: '/settings', key: 'settings', label: '系统设置', sub: '参数与偏好' },
];

export const PAGE_META = {
  dashboard: { title: '总览', sub: '实时监控仓库运行状态' },
  robots: { title: '机器人管理', sub: '机器人状态与详细指标' },
  orders: { title: '订单调度', sub: '订单管理与调度' },
  analytics: { title: '数据分析', sub: '系统性能趋势与策略对比' },
  settings: { title: '系统设置', sub: '仿真参数与显示偏好' },
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
  { key: 'robot_fault', label: '机器人故障', tone: 'fault', desc: '随机机器人发生故障，需注入修复' },
  { key: 'congestion', label: '通道拥堵', tone: 'warn', desc: '指定通道发生拥堵，触发等待绕行' },
  { key: 'order_burst', label: '订单突发', tone: 'info', desc: '突发新增一批订单进入队列' },
  { key: 'shelf_block', label: '货架阻塞', tone: 'warn', desc: '临时封锁一个通道格' },
];
