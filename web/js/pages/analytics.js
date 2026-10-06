// 页面：数据分析。只展示当前这次仿真的快照、采样和事件，不编造周期涨幅或订单类型。

import { store } from '../store.js';
import { values, formatNum, percent, formatMetric, escapeHtml, icon, $ } from '../util.js';
import { lineChart, heatmap, donutChart } from '../charts.js';
import { EVENT_LABEL, PATH_COLORS } from '../constants.js';

const STATUS = [
  { state: 'pending', label: '待分配', color: '#F59E0B' },
  { state: 'assigned', label: '已分配', color: '#3B82F6' },
  { state: 'in_transit', label: '运输中', color: '#0D9488' },
  { state: 'completed', label: '已完成', color: '#16A34A' },
];

export function mount(container) {
  container.innerHTML = `
    <div class="ana-page">
      <div id="anaBanner"></div>
      <div class="ana-kpis" id="anaKpis"></div>
      <div class="ana-charts">
        <article class="card">
          <div class="card-head"><h3>机器人利用率趋势</h3><span class="sub">有任务时间 / 已运行 tick</span></div>
          <div class="card-body">
            <div class="ana-legend" id="anaUtilLegend"></div>
            <div class="chart-box ana-chart"><canvas id="anaUtil"></canvas></div>
          </div>
        </article>
        <article class="card">
          <div class="card-head"><h3>仓库占用热力图</h3><span class="sub" id="anaHeatNote">停留 tick</span></div>
          <div class="card-body">
            <div class="ana-heat-scale"><span>低热度</span><i></i><span>高热度</span></div>
            <div class="chart-box ana-chart"><canvas id="anaHeat"></canvas></div>
          </div>
        </article>
      </div>
      <div class="ana-mid">
        <article class="card">
          <div class="card-head"><h3>订单状态分布</h3><span class="sub">当前快照</span></div>
          <div class="card-body ana-status">
            <div class="chart-box ana-donut"><canvas id="anaStatus"></canvas></div>
            <ul class="ana-status-list" id="anaStatusList"></ul>
          </div>
        </article>
        <article class="card">
          <div class="card-head"><h3>订单处理效率</h3><span class="sub">已发生的取货和送达</span></div>
          <div class="card-body"><div class="ana-metrics" id="anaMetrics"></div></div>
        </article>
        <article class="card">
          <div class="card-head"><h3>异常统计</h3><span class="sub">本次运行累计</span></div>
          <div class="card-body"><div id="anaFaults"></div></div>
        </article>
      </div>
      <article class="card">
        <div class="card-head"><h3>最近事件</h3><span class="sub">仿真事件，新的在上</span></div>
        <div class="card-body"><ul class="ana-events" id="anaEvents"></ul></div>
      </article>
    </div>`;

  const draw = () => {
    const mock = store.mockMode;
    $('#anaBanner').innerHTML = mock
      ? `<div class="banner warn"><div><strong>模拟数据</strong><span>后端未连接。这里的曲线和热力图来自前端演示快照，不能当作实验结果。</span></div></div>`
      : '';
    drawKpis();
    drawUtilization();
    drawHeat();
    drawStatus();
    drawMetrics();
    drawFaults();
    drawEvents();
  };

  const unsub = store.subscribe((tag) => { if (tag === 'world' || tag === 'state') draw(); });
  requestAnimationFrame(draw);
  return unsub;
}

function drawKpis() {
  const kpis = store.kpis || {};
  const completed = kpis.completed_orders || 0;
  const total = kpis.total_orders || 0;
  const rate = total ? (completed / total) : null;
  const cards = [
    ['orders', '#3B82F6', '完成订单', String(completed), total ? `共 ${total} 单 · 吞吐 ${formatMetric(kpis.throughput_per_100_ticks)} / 100 tick` : '还没有订单'],
    ['route', '#16A34A', '订单完成率', rate == null ? '暂无数据' : percent(rate), '已完成 / 全部订单'],
    ['analytics', '#7C3AED', '平均完成时间', completed ? `${formatMetric(kpis.average_completion_ticks)} tick` : '暂无数据', '从创建到送达'],
    ['robot', '#F59E0B', '机器人利用率', kpis.utilization == null || !(store.world?.tick) ? '暂无数据' : percent(kpis.utilization), '全队有任务时间占比'],
    ['alert', '#EF4444', '当前故障', String(kpis.faulted_robots || 0), `累计故障 ${countKind('robot_faulted')} 次`],
  ];
  $('#anaKpis').innerHTML = cards.map(([name, color, label, value, hint]) => `
    <article class="ana-kpi">
      <span class="ana-ico" style="color:${color};background:${color}1a">${icon(name, 18)}</span>
      <div><div class="label">${label}</div><div class="value">${escapeHtml(value)}</div><div class="hint">${escapeHtml(hint)}</div></div>
    </article>`).join('');
}

function drawUtilization() {
  const robots = store.metricsSeries.robots || {};
  const ids = Object.keys(robots).map(Number).filter((id) => Number.isFinite(id)).sort((a, b) => a - b);
  const series = ids
    .filter((id) => (robots[id] || []).length >= 2)
    .map((id) => ({ name: `R${id}`, data: robots[id], color: PATH_COLORS[(id - 1) % PATH_COLORS.length] }));
  $('#anaUtilLegend').innerHTML = series.length
    ? series.map((item) => `<span><i style="background:${item.color}"></i>${item.name}</span>`).join('')
    : '<span>继续运行后，按每台机器人的任务时间画出曲线</span>';
  const canvas = $('#anaUtil');
  if (series.length) lineChart(canvas, series, { min: 0, max: 100 });
  else lineChart(canvas, [{ data: store.metricsSeries.utilization || [], color: '#F59E0B', name: '全队' }], { min: 0, max: 100 });
}

function drawHeat() {
  const grid = store.world?.heatmap || [];
  let max = 0;
  const shelves = new Set((store.world?.map?.obstacles || []).map((point) => `${point.x},${point.y}`));
  grid.forEach((row, y) => row.forEach((value, x) => {
    if (!shelves.has(`${x},${y}`)) max = Math.max(max, value || 0);
  }));
  $('#anaHeatNote').textContent = max ? `最高 ${max} tick` : '还没有停留记录';
  heatmap($('#anaHeat'), grid, {
    obstacles: store.world?.map?.obstacles || [],
    blocked: store.world?.map?.blocked || [],
  });
}

function drawStatus() {
  const orders = values(store.world?.orders || {});
  const abnormal = orders.filter((order) => order.recovery_from);
  const abnormalIds = new Set(abnormal.map((order) => order.id));
  const slices = STATUS.map((item) => ({
    ...item,
    value: orders.filter((order) => order.state === item.state && !abnormalIds.has(order.id)).length,
  }));
  if (abnormal.length) slices.push({ label: '待接运', value: abnormal.length, color: '#EF4444' });
  const total = orders.length;
  donutChart($('#anaStatus'), slices, { legend: false, center: { value: total, label: '总订单' } });
  $('#anaStatusList').innerHTML = slices.map((item) => {
    const share = total ? Math.round((item.value / total) * 100) : 0;
    return `<li><i style="background:${item.color}"></i><span>${item.label}</span><b>${item.value}</b><em>${share}%</em></li>`;
  }).join('') || '<li class="empty">还没有订单</li>';
}

function drawMetrics() {
  const kpis = store.kpis || {};
  const spans = legTimes(store.world?.events || []);
  const tiles = [
    ['平均取货', spans.pickup == null ? '暂无数据' : `${formatMetric(spans.pickup)} tick`, '创建到取到货'],
    ['平均送达', spans.dropoff == null ? '暂无数据' : `${formatMetric(spans.dropoff)} tick`, '取到货到送达'],
    ['累计行驶', `${kpis.total_distance ?? 0} 格`, '全部机器人走过的格子'],
    ['累计等待', `${kpis.total_wait_ticks ?? 0} tick`, '机器人停住的 tick'],
  ];
  $('#anaMetrics').innerHTML = tiles.map(([label, value, hint]) => `
    <div><span>${label}</span><b>${escapeHtml(value)}</b><small>${hint}</small></div>`).join('');
}

function drawFaults() {
  const events = store.world?.events || [];
  const rows = [
    ['机器人故障', events.filter((event) => event.kind === 'robot_faulted').length, '#EF4444'],
    ['道路封锁', events.filter((event) => event.kind === 'map_changed' && /blocked=true/.test(event.detail || '')).length, '#F59E0B'],
    ['道路恢复', events.filter((event) => event.kind === 'map_changed' && /blocked=false/.test(event.detail || '')).length, '#16A34A'],
    ['订单突发', store.orderSurgeCount || 0, '#0D9488'],
  ];
  const max = Math.max(1, ...rows.map((row) => row[1]));
  $('#anaFaults').innerHTML = rows.map(([label, count, color]) => `
    <div class="ana-bar"><span>${label}</span><i><b style="width:${Math.round((count / max) * 100)}%;background:${color}"></b></i><em>${count}</em></div>`).join('');
}

function drawEvents() {
  const events = (store.world?.events || []).slice(-12).reverse();
  $('#anaEvents').innerHTML = events.length
    ? events.map((event) => `<li><span class="t">t${event.tick}</span><i class="dot ${eventTone(event.kind)}"></i><span>${escapeHtml(eventText(event))}</span></li>`).join('')
    : '<li class="empty">运行后，分配、取货、送达、故障和封锁会记在这里。</li>';
}

function countKind(kind) {
  return (store.world?.events || []).filter((event) => event.kind === kind).length;
}

function legTimes(events) {
  const created = new Map();
  const picked = new Map();
  const pickup = [];
  const dropoff = [];
  events.forEach((event) => {
    if (!event.order_id) return;
    if (event.kind === 'order_created') created.set(event.order_id, event.tick);
    if (event.kind === 'order_picked_up') {
      picked.set(event.order_id, event.tick);
      const start = created.get(event.order_id);
      if (start != null && event.tick >= start) pickup.push(event.tick - start);
    }
    if (event.kind === 'order_completed') {
      const start = picked.get(event.order_id);
      if (start != null && event.tick >= start) dropoff.push(event.tick - start);
    }
  });
  const avg = (list) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null);
  return { pickup: avg(pickup), dropoff: avg(dropoff) };
}

function eventText(event) {
  const robot = event.robot_id ? `R${event.robot_id}` : '';
  const order = event.order_id ? `#${event.order_id}` : '';
  if (event.kind === 'order_created') return `新订单 ${order}`;
  if (event.kind === 'order_assigned') return `订单 ${order} 分配给 ${robot}`;
  if (event.kind === 'order_picked_up') return `${robot} 取到订单 ${order}`;
  if (event.kind === 'order_completed') return `订单 ${order} 已送达`;
  if (event.kind === 'robot_faulted') return `${robot} 发生故障`;
  if (event.kind === 'robot_repaired') return `${robot} 已修复`;
  if (event.kind === 'path_replanned') return `${robot} 重新规划路径`;
  if (event.kind === 'robot_waiting') return `${robot} 等待绕行`;
  if (event.kind === 'map_changed') {
    const blocked = /blocked=true/.test(event.detail || '');
    const place = (event.detail || '').replace(/\s*blocked=(true|false)/, '');
    return `${blocked ? '封锁' : '恢复'} ${place}`;
  }
  return EVENT_LABEL[event.kind] || event.kind;
}

function eventTone(kind) {
  if (kind === 'robot_faulted' || kind === 'map_changed') return 'bad';
  if (kind === 'order_completed' || kind === 'robot_repaired') return 'ok';
  if (kind === 'robot_waiting' || kind === 'path_replanned') return 'warn';
  return 'info';
}
