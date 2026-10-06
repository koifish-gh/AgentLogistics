// 页面：机器人管理。列表、简图和详情都来自当前世界快照。

import { store } from '../store.js';
import { values, percent, escapeHtml, $ } from '../util.js';
import { stateBadge } from '../components/widgets.js';
import { robotStatusColor, EVENT_LABEL } from '../constants.js';
import { emptyState } from '../components/ui.js';
import { createRobotSketch } from '../robotSketch.js';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '运行中' },
  { key: 'idle', label: '空闲' },
  { key: 'faulted', label: '故障' },
];

const LAYERS = [
  ['robots', '机器人'],
  ['paths', '路径'],
  ['pickup', '取货点'],
  ['dropoff', '送货点'],
  ['blocked', '封锁'],
  ['shelves', '货架'],
];

function taskText(robot) {
  if (robot.state === 'to_pickup') return '前往取货点';
  if (robot.state === 'to_dropoff') return '前往送货点';
  if (robot.state === 'faulted') return '故障停机';
  return '空闲待命';
}

function avatar(color, size = 32) {
  return `<span class="bot-avatar" style="width:${size}px;height:${size}px;background:${color}"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="14.2" y="5" width="3.6" height="4" rx="1.2" fill="#fff"/><rect x="7" y="9" width="18" height="14" rx="5" fill="#fff"/><circle cx="13" cy="15.5" r="1.7" fill="${color}"/><circle cx="19" cy="15.5" r="1.7" fill="${color}"/><path d="M12 19.2h8" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/></svg></span>`;
}

function utilBar(value) {
  const known = value != null && Number.isFinite(Number(value));
  const width = known ? Math.max(0, Math.min(100, Math.round(Number(value) * 100))) : 0;
  return `<span class="util-pair"><b>${percent(value)}</b><div class="bar util-bar"><i style="width:${width}%"></i></div></span>`;
}

function utilNote(robot) {
  if (store.extrasMode === 'mock') return '演示数据';
  const tick = store.world?.tick ?? 0;
  if (!tick) return '仿真还没开始';
  return `任务中 ${robot.busy_ticks || 0} / ${tick} tick`;
}

export function mount(container) {
  let filter = 'all';
  let keyword = '';
  let detailTab = 'basic';
  let selectedId = store.selected?.kind === 'robot' ? store.selected.robotId : null;
  const layers = { robots: true, paths: true, pickup: true, dropoff: true, blocked: true, shelves: true };

  container.classList.add('page-lock', 'robot-lock');
  container.innerHTML = `
    <div class="robot-page">
      <div class="card">
        <div class="card-body toolbar">
          <div class="seg" id="robotFilter">
            ${FILTERS.map((item) => `<button data-f="${item.key}" class="${item.key === 'all' ? 'active' : ''}">${item.label}</button>`).join('')}
          </div>
          <input id="robotSearch" type="text" placeholder="搜索编号或订单号" style="width:180px" />
        </div>
      </div>
      <div class="robot-work">
        <div class="card robot-list-card"><div id="robotList"></div></div>
        <div class="card robot-map-card">
          <div class="card-head"><h3>仓库简图</h3><span class="sub">俯视，图标对应真实坐标</span></div>
          <div class="sketch-layers" id="sketchLayers">
            ${LAYERS.map(([key, label]) => `<button type="button" data-layer="${key}" class="on">${label}</button>`).join('')}
          </div>
          <div class="robot-sketch-stage" id="sketchStage"><canvas id="robotSketch"></canvas></div>
        </div>
        <div class="card" id="robotDetail"></div>
      </div>
    </div>`;

  const sketch = createRobotSketch($('#robotSketch'), {
    store,
    getLayers: () => layers,
    getSelectedId: () => selectedId,
    onSelect: (robot) => choose(robot),
  });

  const choose = (robot) => {
    selectedId = robot.id;
    store.select({ kind: 'robot', robotId: robot.id, x: robot.position.x, y: robot.position.y });
    draw();
  };

  $('#robotFilter').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    filter = button.dataset.f;
    container.querySelectorAll('#robotFilter button').forEach((item) => item.classList.toggle('active', item === button));
    draw();
  });
  $('#robotSearch').addEventListener('input', (event) => {
    keyword = event.target.value.trim();
    draw();
  });
  $('#sketchLayers').addEventListener('click', (event) => {
    const button = event.target.closest('[data-layer]');
    if (!button) return;
    layers[button.dataset.layer] = !layers[button.dataset.layer];
    button.classList.toggle('on', layers[button.dataset.layer]);
  });
  $('#robotList').addEventListener('click', (event) => {
    const locate = event.target.closest('[data-locate]');
    const card = event.target.closest('[data-robot]');
    const id = Number((locate || card)?.dataset.locate || (locate || card)?.dataset.robot);
    const robot = store.world?.robots?.[id];
    if (!robot) return;
    choose(robot);
    if (locate) $('#sketchStage')?.scrollIntoView({ block: 'nearest' });
  });
  $('#robotDetail').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      detailTab = tab.dataset.tab;
      drawDetail();
      return;
    }
    if (event.target.closest('[data-focus]')) $('#sketchStage')?.scrollIntoView({ block: 'nearest' });
  });

  const matches = (robot) => {
    const order = robot.order_id ? store.world.orders?.[robot.order_id] : null;
    if (keyword && !`${robot.id} ${order?.id || ''}`.includes(keyword)) return false;
    if (filter === 'faulted') return robot.state === 'faulted';
    if (filter === 'idle') return robot.state === 'idle';
    if (filter === 'running') return robot.state === 'to_pickup' || robot.state === 'to_dropoff';
    return true;
  };

  const draw = () => {
    const all = values(store.world?.robots || {}).sort((a, b) => a.id - b.id);
    const counts = {
      all: all.length,
      running: all.filter((robot) => robot.state === 'to_pickup' || robot.state === 'to_dropoff').length,
      idle: all.filter((robot) => robot.state === 'idle').length,
      faulted: all.filter((robot) => robot.state === 'faulted').length,
    };
    container.querySelectorAll('#robotFilter button').forEach((button) => {
      const item = FILTERS.find((entry) => entry.key === button.dataset.f);
      button.textContent = `${item.label} ${counts[item.key]}`;
    });

    const robots = all.filter(matches);
    if (selectedId && !store.world?.robots?.[selectedId]) selectedId = null;
    if (!selectedId && robots.length) selectedId = robots[0].id;
    $('#robotList').innerHTML = robots.map((robot) => {
      const extra = store.extras[robot.id] || {};
      const order = robot.order_id ? store.world.orders?.[robot.order_id] : null;
      const color = robotStatusColor(robot);
      const known = extra.utilization != null && Number.isFinite(Number(extra.utilization));
      const width = known ? Math.max(0, Math.min(100, Math.round(Number(extra.utilization) * 100))) : 0;
      return `
        <div class="rb-card ${selectedId === robot.id ? 'sel' : ''}" data-robot="${robot.id}">
          <div class="rb-head">
            ${avatar(color, 34)}
            <b class="rc-name">R${robot.id}</b>
            ${stateBadge(robot.state)}
          </div>
          <div class="rb-util"><span>利用率</span><b>${percent(extra.utilization)}</b><div class="bar util-bar"><i style="width:${width}%"></i></div></div>
          <div class="rb-line"><span>当前位置</span><b>(${robot.position.x}, ${robot.position.y})</b></div>
          <div class="rb-line"><span>当前任务</span><div>${order ? `<b>订单 #${order.id}</b>` : '<b>暂无任务</b>'} <em>${taskText(robot)}</em></div></div>
          <div class="rb-points">
            ${order ? `<span>取货点 <b>(${order.pickup.x}, ${order.pickup.y})</b></span><span>送货点 <b>(${order.dropoff.x}, ${order.dropoff.y})</b></span>` : '<span>暂无取送货点</span>'}
            <button class="btn sm" type="button" data-locate="${robot.id}">定位</button>
          </div>
        </div>`;
    }).join('') || emptyState('没有匹配的机器人', '调整筛选条件，或等待仿真数据。');

    drawDetail();
  };

  const drawDetail = () => {
    const robot = selectedId ? store.world?.robots?.[selectedId] : null;
    if (!robot) {
      $('#robotDetail').innerHTML = `<div class="card-body">${emptyState('选择一台机器人', '列表、简图和这里会显示同一台机器人。')}</div>`;
      return;
    }
    const extra = store.extras[robot.id] || {};
    const order = robot.order_id ? store.world.orders?.[robot.order_id] : null;
    const path = robot.path || [];
    const events = store.visibleEvents().filter((event) => event.robot_id === robot.id).slice(-8).reverse();
    const color = robotStatusColor(robot);
    const tabs = [
      ['basic', '基本信息'],
      ['task', '任务信息'],
      ['path', '运行轨迹'],
      ['history', '历史记录'],
    ];
    const row = (label, value) => `<div class="info-row"><span>${label}</span><div>${value}</div></div>`;
    const route = [`<li class="now"><i></i><span>当前位置 (${robot.position.x}, ${robot.position.y})</span></li>`];
    if (order && robot.state === 'to_dropoff') {
      route.push(`<li class="done"><i>1</i><span>已到取货点 (${order.pickup.x}, ${order.pickup.y})</span></li>`);
      route.push(`<li class="next"><i>2</i><span>前往送货点 (${order.dropoff.x}, ${order.dropoff.y})</span></li>`);
    } else if (order) {
      route.push(`<li class="next"><i>1</i><span>前往取货点 (${order.pickup.x}, ${order.pickup.y})</span></li>`);
      route.push(`<li><i>2</i><span>前往送货点 (${order.dropoff.x}, ${order.dropoff.y})</span></li>`);
    } else {
      route.push(`<li><i></i><span>${taskText(robot)}</span></li>`);
    }
    let panel = '';
    if (detailTab === 'task') {
      panel = order ? `
        ${row('当前订单', `#${order.id}`)}
        ${row('订单状态', stateBadge(order.state))}
        ${row('优先级', String(order.priority))}
        ${row('取货点', `(${order.pickup.x}, ${order.pickup.y})`)}
        ${row('送货点', `(${order.dropoff.x}, ${order.dropoff.y})`)}
        ${row('剩余路径', path.length ? `${path.length} 格` : '—')}
      ` : '<p class="note">这台机器人当前没有订单。</p>';
    } else if (detailTab === 'path') {
      panel = path.length
        ? `<ol class="path-steps">${path.slice(0, 10).map((point, index) => `<li><i>${index + 1}</i><span>(${point.x}, ${point.y})</span></li>`).join('')}</ol>${path.length > 10 ? `<p class="note">后面还有 ${path.length - 10} 格。</p>` : ''}`
        : '<p class="note">当前没有规划路径。</p>';
    } else if (detailTab === 'history') {
      panel = events.length
        ? `<ul class="event-list">${events.map((event) => `<li><span class="t">t${event.tick}</span><span class="k">${escapeHtml(EVENT_LABEL[event.kind] || event.kind)}</span><span>${escapeHtml(event.detail || '')}</span></li>`).join('')}</ul>`
        : '<p class="note">暂无与该机器人相关的记录。</p>';
    } else {
      panel = `
        ${row('当前位置', `(${robot.position.x}, ${robot.position.y})`)}
        ${row('状态', stateBadge(robot.state))}
        ${row('利用率', `<div class="util-stack">${utilBar(extra.utilization)}<small class="util-note">${utilNote(robot)}</small></div>`)}
        ${row('行驶距离', `${robot.distance ?? 0} 格`)}
        ${row('累计任务', `${robot.completed_orders ?? 0} 单`)}
        ${row('当前任务', order ? `订单 #${order.id}` : taskText(robot))}
        ${row('预计完成', path.length ? `${path.length} tick` : '—')}
        <h4 class="route-title">任务路线</h4>
        <ol class="task-route">${route.join('')}</ol>`;
    }
    $('#robotDetail').innerHTML = `
      <div class="bot-detail">
        <div class="bot-detail-head">
          ${avatar(color, 42)}
          <b>R${robot.id}</b>
          ${stateBadge(robot.state)}
        </div>
        <div class="bot-tabs">
          ${tabs.map(([key, label]) => `<button type="button" data-tab="${key}" class="${detailTab === key ? 'on' : ''}">${label}</button>`).join('')}
        </div>
        <div class="bot-detail-body">${panel}</div>
        <button class="btn sm" data-focus="${robot.id}" type="button">在简图中定位</button>
      </div>`;
  };

  const unsub = store.subscribe((tag) => {
    if (tag === 'world' || tag === 'state' || tag === 'select') {
      if (tag === 'select' && store.selected?.kind === 'robot') selectedId = store.selected.robotId;
      draw();
    }
  });
  draw();
  return () => {
    unsub();
    sketch.destroy();
    container.classList.remove('page-lock', 'robot-lock');
  };
}
