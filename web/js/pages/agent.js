// 页面：Agent 决策。用真实订单、机器人和最近一次决策画出流程、候选对比和简图。

import { store } from '../store.js';
import { values, escapeHtml, $ } from '../util.js';
import { EVENT_LABEL, STATE_LABEL, robotPathColor, robotStatusColor } from '../constants.js';
import { stateBadge } from '../components/widgets.js';

function manhattan(a, b) {
  if (!a || !b) return null;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function colorOf(id) {
  return robotPathColor(id);
}

function face(color, size = 28) {
  return `<span class="bot-avatar" style="width:${size}px;height:${size}px;background:${color}"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="14.2" y="5" width="3.6" height="4" rx="1.2" fill="#fff"/><rect x="7" y="9" width="18" height="14" rx="5" fill="#fff"/><circle cx="13" cy="15.5" r="1.7" fill="${color}"/><circle cx="19" cy="15.5" r="1.7" fill="${color}"/><path d="M12 19.2h8" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/></svg></span>`;
}

export function mount(container) {
  let previewId = null;
  container.innerHTML = `
    <div class="agent-page">
      <div class="agent-top">
        <ol class="agent-flow" id="agentSteps"></ol>
      </div>
      <div class="agent-main">
        <section class="agent-map-card">
          <div class="agent-map-head">
            <h3>调度简图</h3>
            <button class="btn sm" id="agentLocate" type="button">在总览地图查看</button>
          </div>
          <div class="agent-map-stage" id="agentStage">
            <canvas id="agentSketch"></canvas>
            <div class="agent-callout" id="agentCallout"></div>
          </div>
          <div class="agent-legend" id="agentLegend">
            <span><i class="lg-shelf"></i>货架</span>
            <span><i class="lg-bot"></i>机器人</span>
            <span><i class="lg-pick"></i>取货点</span>
            <span><i class="lg-drop"></i>送货点</span>
            <span><i class="lg-path"></i>规划路线</span>
            <span><i class="lg-block"></i>封锁</span>
          </div>
          <div id="agentScore"></div>
          <div class="agent-brief" id="agentBrief"></div>
        </section>
        <aside class="agent-side">
          <section class="agent-panel" id="agentNow"></section>
          <section class="agent-panel" id="agentProcess"></section>
          <section class="agent-panel" id="agentRecords"></section>
        </aside>
      </div>
      <div class="agent-bottom">
        <article id="agentReasons"></article>
        <article id="agentLogCard"></article>
      </div>
    </div>`;

  $('#agentLocate').addEventListener('click', () => {
    const order = focusOrder();
    if (!order) return;
    store.requestFocus({ kind: 'order', orderId: order.id });
    location.hash = '#/';
  });
  $('#agentScore').addEventListener('click', (event) => {
    const row = event.target.closest('[data-robot]');
    if (!row) return;
    previewId = Number(row.dataset.robot);
    draw();
  });

  const draw = () => {
    const order = focusOrder();
    const turn = meaningfulTurn();
    const actions = turnActions(turn);
    const robots = values(store.world?.robots || {}).sort((a, b) => a.id - b.id);
    const chosenId = chosenRobotId(order, actions);
    const shownId = previewId && robots.some((robot) => robot.id === previewId) ? previewId : chosenId;
    const rows = scoreRows(order, robots, chosenId);
    drawSteps(order, robots, chosenId);
    drawCallout(order, chosenId, turn);
    drawNow(order, turn, rows, chosenId);
    drawProcess(order, turn, actions, rows, chosenId);
    drawScore(order, rows, shownId);
    drawReasons(order, rows, chosenId, turn);
    drawLog();
    drawRecords();
    drawSketch(order, robots, shownId);
  };

  const unsub = store.subscribe((tag) => {
    if (tag === 'world' || tag === 'state' || tag === 'agent' || tag === 'select') draw();
  });
  const stage = $('#agentStage');
  const observer = new ResizeObserver(() => drawSketch(focusOrder(), values(store.world?.robots || {}), previewId || chosenRobotId(focusOrder(), turnActions(meaningfulTurn()))));
  observer.observe(stage);
  requestAnimationFrame(draw);
  if (store.backend === 'agent') store.refreshAgent();
  return () => {
    observer.disconnect();
    unsub();
  };
}

function focusOrder() {
  const orders = values(store.world?.orders || {});
  const selected = store.selected?.kind === 'order'
    ? orders.find((order) => order.id === store.selected.orderId && order.state !== 'completed')
    : null;
  if (selected) return selected;
  return orders.find((order) => order.state === 'in_transit' || order.state === 'assigned')
    || orders.find((order) => order.state === 'pending')
    || completedFromTrace(orders)
    || null;
}

function completedFromTrace(orders) {
  const trace = store.agentTrace || [];
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const assignment = [...turnActions(trace[index])].reverse().find((action) => action.name === 'assign_order');
    const linked = assignment ? orders.find((order) => order.id === assignment.arguments.order_id) : null;
    if (linked) return linked;
  }
  return orders.find((order) => order.state === 'completed') || null;
}

function chosenRobotId(order, actions) {
  if (!order) return null;
  const match = (list) => [...list].reverse().find((action) => action.name === 'assign_order' && action.arguments.order_id === order.id);
  const assignment = match(actions);
  if (assignment) return Number(assignment.arguments.robot_id);
  if (order.robot_id) return Number(order.robot_id);
  const trace = store.agentTrace || [];
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const found = match(turnActions(trace[index]));
    if (found) return Number(found.arguments.robot_id);
  }
  return null;
}

function goalOf(order, robot) {
  if (!order) return null;
  if (robot && order.robot_id === robot.id && robot.state === 'to_dropoff') return order.dropoff;
  return order.pickup;
}

function conflictOf(robot, robots) {
  const others = robots.filter((item) => item.id !== robot.id && (item.state === 'to_pickup' || item.state === 'to_dropoff'));
  const head = others.some((other) => {
    const next = robot.path?.[0];
    const back = other.path?.[0];
    return next && back && next.x === other.position.x && next.y === other.position.y
      && back.x === robot.position.x && back.y === robot.position.y;
  });
  if (head) return { level: '高', text: '正对面有机器人' };
  const crowded = others.filter((other) => other.position && Math.abs(other.position.x - robot.position.x) <= 1).length;
  if (crowded >= 2) return { level: '中', text: '同通道机器人较多' };
  return { level: '低', text: '附近通道通畅' };
}

function scoreRows(order, robots, chosenId) {
  if (!order) return [];
  const totalDone = robots.reduce((sum, robot) => sum + (robot.completed_orders || 0), 0);
  const raw = robots.map((robot) => {
    const busy = !!(robot.order_id && robot.order_id !== order.id && robot.id !== chosenId);
    const goal = goalOf(order, robot);
    const distance = robot.id === chosenId && robot.path?.length
      ? robot.path.length
      : manhattan(robot.position, goal);
    const done = robot.completed_orders || 0;
    const cost = (distance ?? 99) + done * 4;
    return { robot, distance, done, cost, busy, conflict: conflictOf(robot, robots) };
  });
  const best = Math.min(...raw.map((row) => row.cost));
  const worst = Math.max(...raw.map((row) => row.cost));
  return raw
    .map((row) => ({
      ...row,
      load: totalDone ? Math.round((row.done / totalDone) * 100) : 0,
      score: worst === best ? 90 : Math.round(100 - ((row.cost - best) / (worst - best)) * 28),
      picked: row.robot.id === chosenId,
    }))
    .sort((a, b) => b.score - a.score || a.robot.id - b.robot.id);
}

function drawSteps(order, robots, chosenId) {
  const robot = chosenId ? store.world?.robots?.[chosenId] : null;
  const executing = robot && (robot.state === 'to_pickup' || robot.state === 'to_dropoff');
  const finished = order?.state === 'completed';
  const idle = robots.filter((item) => item.state === 'idle').length;
  const running = robots.filter((item) => item.state === 'to_pickup' || item.state === 'to_dropoff').length;
  const active = !order ? 0 : finished ? 4 : executing ? 3 : chosenId ? 2 : robots.length ? 1 : 0;
  const steps = [
    ['find', 'rose', '事件发现', order ? `订单 #${order.id} · 优先级 ${order.priority}` : '等待关键事件'],
    ['analyze', 'blue', 'Agent 分析', robots.length ? `${robots.length} 台 · 空闲 ${idle} · 执行 ${running}` : '等待机器人'],
    ['choose', 'violet', '决策方案', chosenId ? `选择 R${chosenId}` : '尚未指定'],
    ['run', 'green', '执行调度', finished ? '已送达' : executing ? STATE_LABEL[robot.state] : '待出发'],
  ];
  const icons = {
    find: '<path d="M12 8v5M12 16.2v.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    analyze: '<circle cx="7" cy="12" r="2.2" fill="currentColor"/><circle cx="17" cy="7" r="2.2" fill="currentColor"/><circle cx="17" cy="17" r="2.2" fill="currentColor"/><path d="M9 12h4M15.2 8.6 9.8 11M15.2 15.4 9.8 13" stroke="currentColor" stroke-width="1.4"/>',
    choose: '<rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 12.2 10.6 15 16 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    run: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 8.8v6.4L16 12z" fill="currentColor"/>',
  };
  $('#agentSteps').innerHTML = steps.map(([key, tone, title, detail], index) => {
    const state = index < active ? 'done' : index === active ? 'now' : '';
    return `<li class="tone-${tone} ${state}"><span class="flow-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg></span><span><b>${String(index + 1).padStart(2, '0')} ${title}</b><small>${escapeHtml(detail)}</small></span></li>`;
  }).join('');
}

function drawCallout(order, chosenId, turn) {
  const box = $('#agentCallout');
  const title = turn?.trigger?.title || (order ? `订单 #${order.id}` : '等待关键事件');
  box.classList.toggle('bad', /故障|对向/.test(title));
  if (!order && !turn?.trigger) {
    box.innerHTML = '<b>等待关键事件</b><span>开始运行后，这里标出正在决策的订单。</span>';
    return;
  }
  const where = order ? `取货 (${order.pickup.x}, ${order.pickup.y}) → 送货 (${order.dropoff.x}, ${order.dropoff.y})` : (turn.trigger.detail || '');
  box.innerHTML = `<b>${escapeHtml(title)}</b><span>${escapeHtml(where)}</span>${chosenId ? `<span>当前选择 R${chosenId}</span>` : ''}`;
}

function drawNow(order, turn, rows, chosenId) {
  const chosen = rows.find((row) => row.robot.id === chosenId);
  const robot = chosenId ? store.world?.robots?.[chosenId] : null;
  const live = store.backend === 'agent' && !store.mockMode;
  const finished = order?.state === 'completed';
  const executing = robot && (robot.state === 'to_pickup' || robot.state === 'to_dropoff');
  const pill = store.deciding ? '决策中' : finished ? '已完成' : executing ? '进行中' : live ? '运行中' : '未连接';
  const tone = finished ? 'ok' : store.deciding ? 'warn' : '';
  $('#agentNow').innerHTML = `
    <div class="agent-panel-head"><h3>当前决策</h3><span class="agent-pill ${tone}"><i></i>${pill}</span></div>
    ${order ? `<div class="agent-order">
      ${face(chosenId ? colorOf(chosenId) : '#64748b', 40)}
      <div>
        <b>订单 #${order.id}</b>
        ${stateBadge(order.state)}
        <span class="pri">优先级 ${order.priority}</span>
        <div class="agent-route"><span>取 (${order.pickup.x}, ${order.pickup.y})</span><span>送 (${order.dropoff.x}, ${order.dropoff.y})</span></div>
      </div>
    </div>
    <div class="agent-chosen">
      ${robot ? face(robotStatusColor(robot), 28) : ''}
      <div>
        <b>${chosenId ? `分配给 R${chosenId}` : '尚未分配'}</b>
        <div>${chosen ? `剩余 ${chosen.distance ?? '—'} 格 · 综合 ${chosen.score}` : '等待空闲机器人'}${robot ? ` · ${STATE_LABEL[robot.state] || robot.state}` : ''}</div>
      </div>
    </div>` : '<p class="agent-empty">生成订单并开始运行后，这里显示本次分配。</p>'}`;
}

function drawProcess(order, turn, actions, rows, chosenId) {
  const chosen = rows.find((row) => row.robot.id === chosenId);
  const robot = chosenId ? store.world?.robots?.[chosenId] : null;
  const idle = rows.filter((row) => row.robot.state === 'idle' && !row.busy).map((row) => `R${row.robot.id}`);
  const busy = rows.filter((row) => row.busy || (row.robot.state !== 'idle' && row.robot.id !== chosenId)).map((row) => `R${row.robot.id}`);
  const steps = [
    ['发现事件', turn?.trigger?.title ? `${turn.trigger.title}${turn.tick != null ? ` · t${turn.tick}` : ''}` : (order ? `订单 #${order.id}` : '等待关键事件')],
    ['评估机器人', rows.length ? `${idle.length ? `空闲 ${idle.join('、')}` : '没有空闲'}${busy.length ? ` · 占用 ${busy.join('、')}` : ''}` : '等待机器人'],
    ['选择方案', chosen ? `R${chosen.robot.id} · 代价 ${chosen.cost} · 综合 ${chosen.score}` : '尚未指定'],
    ['规划路径', robot?.path?.length ? `剩余 ${robot.path.length} 格` : (actions.some((action) => action.name === 'plan_path' || action.name === 'replan') ? '已比较或改写路径' : '按距离和已完成单数')],
    ['执行调度', order?.state === 'completed' ? '订单已送达' : (robot ? STATE_LABEL[robot.state] : '待出发')],
  ];
  const current = !order ? 0 : order.state === 'completed' ? 5 : (robot && (robot.state === 'to_pickup' || robot.state === 'to_dropoff')) ? 4 : chosenId ? 2 : 1;
  $('#agentProcess').innerHTML = `<h3>Agent 决策过程</h3><ol class="agent-timeline">${steps.map(([title, detail], index) => {
    const state = index < current ? 'done' : index === current ? 'now' : '';
    return `<li class="${state}"><i>${index + 1}</i><span><b>${title}</b><small>${escapeHtml(detail)}</small></span></li>`;
  }).join('')}</ol>`;
}

function drawScore(order, rows, shownId) {
  $('#agentScore').innerHTML = `
    <h3>候选对比</h3>
    <p class="note">代价 = 到目标的格数 + 已完成单数 × 4。点一台机器人，简图会标出它。</p>
    ${rows.length ? `<div class="agent-cands">${rows.map((row) => `<button type="button" class="agent-cand ${row.robot.id === shownId ? 'pick' : ''}" data-robot="${row.robot.id}">
      ${face(colorOf(row.robot.id), 26)}
      <b>R${row.robot.id}</b>
      ${stateBadge(row.robot.state)}
      <span>${row.distance ?? '—'} 格</span>
      <span class="agent-score">${row.score}</span>
      <em>${row.picked ? '已选' : row.busy ? '占用' : row.conflict.level}</em>
    </button>`).join('')}</div>` : `<p class="agent-empty">${order ? '还没有可比较的机器人。' : '还没有订单，对比会在订单出现后列出。'}</p>`}`;
}

function drawReasons(order, rows, chosenId, turn) {
  const chosen = rows.find((row) => row.robot.id === chosenId) || rows[0];
  const items = [];
  let brief = '开始运行后，这里用一句话说明这次为什么这样分配。';
  if (!chosen || !order) {
    items.push(['等待订单和机器人', '开始运行后，这里解释为什么选这台机器人。']);
  } else {
    const ranked = rows.filter((row) => row.score != null).sort((a, b) => b.score - a.score);
    const rank = Math.max(1, ranked.findIndex((row) => row.robot.id === chosen.robot.id) + 1);
    items.push([`到目标约 ${chosen.distance ?? '—'} 格`, chosen.robot.state === 'to_dropoff' ? '这台已经取到货，距离按剩余送货路径计算。' : '距离是当前位置到取货点的曼哈顿距离；正在执行的机器人用剩余路径。']);
    items.push([`已完成 ${chosen.done} 单`, `负载占全部完成单的 ${chosen.load}%。每多完成 1 单，代价增加 4 格。`]);
    items.push([`通道冲突${chosen.conflict.level}`, chosen.conflict.text]);
    const better = rows.find((row) => row.score != null && row.robot.id !== chosen.robot.id && row.score > chosen.score);
    const keep = chosen.picked && better && order.state !== 'completed'
      ? `订单 #${order.id} 由 R${chosen.robot.id} 执行。按当前坐标，R${better.robot.id} 代价更低；进行中的订单保持原分配。`
      : (chosen.picked ? `订单 #${order.id} 实际交给 R${chosen.robot.id}。` : '这是预览，还没有写成分配。');
    items.push([`综合评分 ${chosen.score ?? '—'}`, `代价 ${chosen.cost ?? '—'}，在可分配的机器人里排第 ${rank}。${keep}`]);
    brief = keep;
    if (turn?.explanation) items.push(['本轮记录', turn.explanation]);
  }
  $('#agentBrief').innerHTML = `<b>决策说明</b><span>${escapeHtml(turn?.explanation || brief)}</span>`;
  $('#agentReasons').innerHTML = `<h3>决策原因${chosenId ? ` · R${chosenId}` : ''}</h3><ul class="agent-reasons">${items.map(([title, text]) => `<li><span class="ok">✓</span><span><b>${escapeHtml(title)}</b><br>${escapeHtml(text)}</span></li>`).join('')}</ul>`;
}

function drawLog() {
  const lines = [];
  const trace = store.agentTrace || [];
  for (let index = trace.length - 1; index >= 0 && lines.length < 40; index -= 1) {
    const turn = trace[index];
    const actions = turnActions(turn).filter((action) => action.name !== 'step');
    if (!actions.length && !turn?.trigger && !turn?.explanation) continue;
    if (turn?.trigger) lines.push([`t${turn.tick}`, turn.trigger.title, turn.trigger.detail || '']);
    actions.forEach((action) => {
      lines.push([`t${turn.tick ?? ''}`, actionLabel(action), actionDetail(action)]);
    });
    if (turn?.explanation) lines.push([`t${turn.tick}`, '决策说明', turn.explanation]);
  }
  const box = document.querySelector('#agentLogCard .agent-log');
  const top = box ? box.scrollTop : 0;
  $('#agentLogCard').innerHTML = `<h3>决策日志</h3>${lines.length ? `<ul class="agent-log">${lines.map(([time, title, detail]) => `<li><span class="t">${escapeHtml(time)}</span><span><b>${escapeHtml(title)}</b><br><span style="color:var(--text-2)">${escapeHtml(detail)}</span></span></li>`).join('')}</ul>` : '<p class="agent-empty">还没有决策日志。点总览里的开始后，分配、让路和故障改派会记在这里。</p>'}`;
  const next = document.querySelector('#agentLogCard .agent-log');
  if (next) next.scrollTop = top;
}

function drawRecords() {
  const trace = store.agentTrace || [];
  const rows = [];
  trace.forEach((turn) => {
    turnActions(turn).forEach((action) => {
      if (!['assign_order', 'replan', 'repair_robot'].includes(action.name)) return;
      const orderId = action.arguments.order_id;
      const robotId = action.arguments.robot_id;
      const order = orderId ? store.world?.orders?.[orderId] : null;
      let reason = '按代价分配';
      if (action.name === 'replan') reason = '对向让路';
      if (action.name === 'repair_robot') reason = '手动修复';
      if (action.name === 'assign_order') reason = '完成单数 + 距离';
      const status = order?.state === 'completed' ? '已完成' : action.name === 'replan' ? '已让路' : '执行中';
      rows.push({ tick: turn.tick, orderId, robotId, reason, status });
    });
  });
  const recent = rows.slice(-40).reverse();
  const box = document.querySelector('#agentRecords .agent-records');
  const top = box ? box.scrollTop : 0;
  $('#agentRecords').innerHTML = `<h3>最近决策记录</h3>${recent.length ? `<ul class="agent-records">${recent.map((row) => `<li>
    <span class="t">t${row.tick}</span>
    <span>${escapeHtml(row.reason === '对向让路' ? '路径让路' : row.reason === '手动修复' ? '修复' : '分配')} · ${row.orderId ? `#${row.orderId}` : '—'}${row.robotId ? ` · R${row.robotId}` : ''}</span>
    <em class="tag-${row.status}">${row.status}</em>
  </li>`).join('')}</ul>` : '<p class="agent-empty">运行后会留下分配和让路记录。</p>'}`;
  const next = document.querySelector('#agentRecords .agent-records');
  if (next) next.scrollTop = top;
}

function drawSketch(order, robots, shownId) {
  const canvas = $('#agentSketch');
  const stage = $('#agentStage');
  if (!canvas || !stage) return;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.min(stage.clientWidth, 800));
  const height = Math.max(1, Math.min(stage.clientHeight, 480));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#e7f2fb';
  ctx.fillRect(0, 0, width, height);
  const map = store.world?.map;
  if (!map) {
    ctx.fillStyle = '#64748b';
    ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText('等待地图', 16, 28);
    return;
  }
  const pad = 22;
  const cell = Math.min((width - pad * 2) / map.width, (height - pad * 2) / map.height);
  const ox = (width - cell * map.width) / 2;
  const oy = (height - cell * map.height) / 2;
  const dark = document.documentElement.dataset.theme === 'dark';
  ctx.fillStyle = dark ? '#0b1220' : '#eef5fb';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = dark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.25)';
  ctx.lineWidth = 1;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      ctx.strokeRect(ox + x * cell, oy + y * cell, cell, cell);
    }
  }
  ctx.fillStyle = dark ? '#1d4e89' : '#7eb6ea';
  (map.obstacles || []).forEach((point) => {
    const inset = Math.max(0.5, cell * 0.14);
    ctx.fillRect(ox + point.x * cell + inset, oy + point.y * cell + inset, Math.max(1, cell - inset * 2), Math.max(1, cell - inset * 2));
  });
  ctx.fillStyle = 'rgba(239,68,68,0.35)';
  (map.blocked || []).forEach((point) => {
    ctx.fillRect(ox + point.x * cell, oy + point.y * cell, cell, cell);
  });
  const at = (x, y) => ({ x: ox + (x + 0.5) * cell, y: oy + (y + 0.5) * cell });
  const focus = robots.find((item) => item.id === shownId);
  if (focus?.path?.length) {
    const start = sketchPos(focus);
    ctx.strokeStyle = colorOf(focus.id);
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(at(start.x, start.y).x, at(start.x, start.y).y);
    focus.path.forEach((point) => {
      const p = at(point.x, point.y);
      ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const pin = (point, color, glyph) => {
    if (!point) return;
    const p = at(point.x, point.y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y - 6, 6, Math.PI, 0);
    ctx.lineTo(p.x, p.y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 8px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, p.x, p.y - 6);
    ctx.textBaseline = 'alphabetic';
  };
  if (order) {
    pin(order.pickup, '#2563eb', '取');
    pin(order.dropoff, '#7c3aed', '送');
  }
  const radius = Math.max(7, Math.min(12, cell * 0.42));
  const ordered = robots.filter((item) => item.id !== shownId).concat(robots.filter((item) => item.id === shownId));
  ordered.forEach((item) => {
    const pos = sketchPos(item);
    const p = at(pos.x, pos.y);
    drawFace(ctx, p.x, p.y, item.id === shownId ? radius + 1 : radius, colorOf(item.id), robotStatusColor(item), `R${item.id}`, item.id === shownId);
  });
}

function sketchPos(robot) {
  if (store.motion?.get?.(robot.id)) return store.displayPos(robot.id);
  return robot.position;
}

function drawFace(ctx, x, y, radius, color, ring, label, selected) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = selected ? 2.5 : 1.6;
  ctx.strokeStyle = selected ? '#ffffff' : ring;
  ctx.stroke();
  if (selected) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x - radius * 0.28, y - radius * 0.05, radius * 0.16, 0, Math.PI * 2);
  ctx.arc(x + radius * 0.28, y - radius * 0.05, radius * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x - radius * 0.28, y - radius * 0.05, radius * 0.07, 0, Math.PI * 2);
  ctx.arc(x + radius * 0.28, y - radius * 0.05, radius * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = document.documentElement.dataset.theme === 'dark' ? '#e2e8f0' : '#0f172a';
  ctx.font = `700 ${Math.max(9, radius * 0.7)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(label, x, y + radius + 2);
  ctx.restore();
}

function latestTurn() {
  const trace = store.agentTrace || [];
  return trace.length ? trace[trace.length - 1] : null;
}

function meaningfulTurn() {
  const trace = store.agentTrace || [];
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    if (turnActions(trace[index]).some((action) => action.name !== 'step')) return trace[index];
  }
  return latestTurn();
}

function turnActions(turn) {
  const actions = turn?.actions || [];
  if (actions.length && actions[0] && ('agent' in actions[0] || Array.isArray(actions[0].actions))) {
    return actions.flatMap((block) => (block.actions || []).filter((item) => item && item.name).map((item) => ({
      name: item.name,
      arguments: item.arguments || {},
      result: item.result,
    })));
  }
  return actions.filter((item) => item && item.name).map((item) => ({
    name: item.name,
    arguments: item.arguments || {},
    result: item.result,
  }));
}

function actionLabel(action) {
  if (action.name === 'assign_order') return '分配订单';
  if (action.name === 'replan') return '路径让路';
  if (action.name === 'plan_path') return '比较路径';
  if (action.name === 'repair_robot') return '修复机器人';
  return EVENT_LABEL[action.name] || action.name;
}

function actionDetail(action) {
  const args = action.arguments || {};
  if (action.name === 'assign_order') return `#${args.order_id} 交给 R${args.robot_id}`;
  if (action.name === 'replan') return `R${args.robot_id} 避开 (${args.avoid?.[0]?.x ?? '—'}, ${args.avoid?.[0]?.y ?? '—'})`;
  if (action.name === 'repair_robot') return `恢复 R${args.robot_id}`;
  if (action.name === 'plan_path') return `(${args.start?.x},${args.start?.y}) → (${args.goal?.x},${args.goal?.y})`;
  return action.name;
}
