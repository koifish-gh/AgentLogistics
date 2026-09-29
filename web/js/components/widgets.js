// 复用组件：KPI、仿真控制、场景事件、选中对象 Inspector、Agent 决策、表格、Tabs、Modal

import { STATE_LABEL, EVENT_LABEL, EVENT_TONE, SCENE_EVENTS, robotStatusColor } from '../constants.js';
import { store } from '../store.js';
import { values, escapeHtml, formatNum, percent, icon, $ } from '../util.js';
import { sparkline } from '../charts.js';

// ---------- 标签 ----------
export function stateBadge(state) {
  return `<span class="badge ${state}"><i></i>${STATE_LABEL[state] || state}</span>`;
}

// ---------- 颜色工具（与 isoMap 派生规则一致） ----------
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return { r: 128, g: 128, b: 128 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
function mixColor(hex, withHex, ratio) {
  const a = hexToRgb(hex);
  const b = hexToRgb(withHex);
  const r = Math.round(a.r + (b.r - a.r) * ratio);
  const g = Math.round(a.g + (b.g - a.g) * ratio);
  const bl = Math.round(a.b + (b.b - a.b) * ratio);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}
const darken = (hex, r) => mixColor(hex, '#000000', r);
const brighten = (hex, r) => mixColor(hex, '#ffffff', r);

// ---------- 机器人 3D 图标（等距 AGV，状态色着色） ----------
export function robotIcon(statusColor) {
  const top = brighten(statusColor, 0.38);
  const mid = darken(statusColor, 0.32);
  const dark = darken(statusColor, 0.52);
  const panel = brighten(statusColor, 0.62);
  return `<svg viewBox="0 0 44 44">
    <ellipse cx="22" cy="37" rx="13" ry="2.5" fill="rgba(0,0,0,0.4)"/>
    <polygon points="9,15 22,11 22,29 9,33" fill="${dark}"/>
    <polygon points="22,11 35,15 35,33 22,29" fill="${mid}"/>
    <polygon points="9,15 22,11 35,15 22,19" fill="${top}" stroke="${statusColor}" stroke-width="0.6"/>
    <polygon points="13,15.4 22,12.6 31,15.4 22,18.2" fill="${panel}"/>
    <polygon points="22,12.6 26,15 23.5,15 23.5,17 20.5,17 20.5,15 18,15" fill="#ffffff" opacity="0.92"/>
    <circle cx="29.5" cy="14.6" r="1.2" fill="${statusColor}" stroke="rgba(255,255,255,0.8)" stroke-width="0.4"/>
  </svg>`;
}

// ---------- 核心 KPI ----------
function trend(series) {
  if (!series || series.length < 2) return { cls: '', mark: '' };
  const a = series[series.length - 1];
  const b = series[series.length - 2];
  if (a > b + 1e-6) return { cls: 'up', mark: '▲' };
  if (a < b - 1e-6) return { cls: 'down', mark: '▼' };
  return { cls: '', mark: '—' };
}

export function renderKpi(container) {
  const unsub = store.subscribe((tag) => {
    if (tag === 'world' || tag === 'state') draw();
  });
  const draw = () => {
    const kpis = store.kpis || {};
    const t1 = trend(store.kpiHistory.throughput);
    const t2 = trend(store.kpiHistory.utilization);
    const t3 = trend(store.kpiHistory.pending);
    const t4 = trend(store.kpiHistory.wait);
    container.innerHTML = `
      <div class="kpi-grid">
        ${kpi('实时吞吐量', formatNum(kpis.throughput_per_100_ticks), '/100 tick', t1, 'throughput')}
        ${kpi('平均完成时间', formatNum(kpis.average_completion_ticks), 'tick', t4, null)}
        ${kpi('机器人利用率', percent(kpis.utilization), '', t2, 'utilization')}
        ${kpi('待处理订单', kpis.pending_orders ?? 0, '', t3, 'pending')}
      </div>`;
    requestAnimationFrame(() => {
      container.querySelectorAll('canvas[data-spark]').forEach((c) => {
        sparkline(c, store.kpiHistory[c.dataset.spark] || [], '#2cc6b0', { fill: true });
      });
    });
  };
  draw();
  return unsub;
}

function kpi(label, value, unit, t, sparkKey) {
  return `<div class="kpi">
    <div class="k-label">${label}</div>
    <div class="k-value">${value}${unit ? `<span class="k-unit">${unit}</span>` : ''}</div>
    ${t && t.mark ? `<div class="k-trend ${t.cls}">${t.mark} 较上帧</div>` : `<div class="k-trend">—</div>`}
    ${sparkKey ? `<canvas data-spark="${sparkKey}"></canvas>` : ''}
  </div>`;
}

// ---------- 仿真控制 ----------
export function renderSimControl(container) {
  container.innerHTML = `
    <div class="ctl">
      <div class="ctl-row">
        <label>运行状态</label>
        <span class="badge ${store.playing ? 'to_pickup' : 'idle'}" id="ctlRun"><i></i>${store.playing ? '运行中' : '已暂停'}</span>
      </div>
      <div class="ctl-row">
        <label>策略</label>
        <select id="ctlStrategy" style="flex:1">
          <option value="nearest">nearest 最近优先</option>
          <option value="balanced">balanced 工作量均衡</option>
          <option value="manual">manual Agent 接管</option>
        </select>
      </div>
      <div class="ctl-row">
        <label>订单生成</label>
        <span class="seg" id="ctlOrderMode">
          <button data-mode="auto" class="active">自动</button>
          <button data-mode="manual">手动</button>
        </span>
      </div>
      <div class="ctl-row">
        <label>随机种子</label>
        <input id="ctlSeed" type="number" value="${store.seed}" style="flex:1" />
      </div>
      <div class="ctl-row" style="gap:8px">
        <button class="btn accent" id="ctlDispatch" style="flex:1">立即派单</button>
        <button class="btn" id="ctlGenerate" style="flex:1">生成订单</button>
        <button class="btn" id="ctlReset" style="flex:1">重置</button>
      </div>
      <p class="sub" style="margin:0;font-size:11px;line-height:1.5">manual 策略下「立即派单」不生效，请在订单页手动分配。</p>
    </div>`;

  const strategySel = $('#ctlStrategy');
  strategySel.value = store.world?.strategy || store.strategy;
  strategySel.addEventListener('change', () => store.setStrategy(strategySel.value).catch((e) => store.notify('error', e)));
  $('#ctlOrderMode').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    store.set({ autoOrders: btn.dataset.mode === 'auto' });
    container.querySelectorAll('#ctlOrderMode button').forEach((b) => b.classList.toggle('active', b === btn));
  });
  $('#ctlDispatch').addEventListener('click', () => store.dispatch().catch((e) => store.notify('error', e)));
  $('#ctlGenerate').addEventListener('click', () => store.generateOrders(20).catch((e) => store.notify('error', e)));
  $('#ctlReset').addEventListener('click', () => {
    store.seed = Number($('#ctlSeed').value) || 42;
    store.reset(store.seed).catch((e) => store.notify('error', e));
  });

  const unsub = store.subscribe((tag) => {
    if (tag === 'world' || tag === 'state') {
      strategySel.value = store.world?.strategy || store.strategy;
      $('#ctlSeed').value = store.seed;
      const run = $('#ctlRun');
      if (run) {
        run.className = `badge ${store.playing ? 'to_pickup' : 'idle'}`;
        run.innerHTML = `<i></i>${store.playing ? '运行中' : '已暂停'}`;
      }
    }
  });
  return unsub;
}

// ---------- 场景事件 ----------
export function renderEventPanel(container) {
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span class="sub" style="font-size:12px">注入异常以观察调度反应</span>
      <button class="btn sm accent" id="injectEventBtn">+ 注入事件</button>
    </div>
    <ul class="event-list" id="recentEvents" style="max-height:170px"></ul>`;

  const openInjectModal = () => {
    const toneColor = { fault: 'var(--danger)', warn: 'var(--warning)', info: 'var(--info)' };
    const modal = openModal({
      title: '注入场景事件',
      body: `<div style="display:flex;flex-direction:column;gap:8px">
        ${SCENE_EVENTS.map((e) => `
          <button class="inject-item" data-key="${e.key}" style="display:flex;align-items:center;gap:11px;padding:11px;border:1px solid var(--border);border-radius:9px;background:var(--surface-2);text-align:left;width:100%;cursor:pointer">
            <i style="width:9px;height:9px;border-radius:50%;background:${toneColor[e.tone] || 'var(--primary)'};flex:0 0 auto"></i>
            <span style="flex:1"><b style="display:block;font-size:13px">${e.label}</b><span style="color:var(--text-3);font-size:11px">${e.desc}</span></span>
          </button>`).join('')}
      </div>`,
    });
    modal.mask.querySelectorAll('[data-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        modal.close();
        store.injectSceneEvent(key).catch((e) => store.notify('error', e));
      });
    });
  };

  $('#injectEventBtn').addEventListener('click', openInjectModal);

  const draw = () => {
    const events = (store.world?.events || []).slice(-6).reverse();
    $('#recentEvents').innerHTML = events.map((ev) => {
      const label = EVENT_LABEL[ev.kind] || ev.kind;
      const tone = EVENT_TONE[ev.kind] || 'info';
      return `<li><span class="t">t${ev.tick}</span><span class="k ${tone}">${label}</span><span>${escapeHtml(ev.detail)}${ev.robot_id ? ` · R${ev.robot_id}` : ''}${ev.order_id ? ` · #${ev.order_id}` : ''}</span></li>`;
    }).join('') || '<li style="color:var(--text-3)">暂无事件</li>';
  };
  const unsub = store.subscribe((tag) => { if (tag === 'world' || tag === 'state') draw(); });
  draw();
  return unsub;
}

// ---------- 选中对象 Inspector ----------
export function renderInspector(container) {
  const draw = () => {
    const sel = store.selected;
    const world = store.world;
    if (!sel || !world) {
      container.innerHTML = '';
      return;
    }
    let body = '';
    if (sel.kind === 'robot') {
      const robot = world.robots?.[sel.robotId];
      if (!robot) { container.innerHTML = ''; return; }
      const extra = store.extras[robot.id] || {};
      const path = robot.path || [];
      const pathViz = path.slice(0, 8).map((_, i) => `<i class="${i === path.length - 1 ? 'pending' : ''}"></i>`).join('');
      body = `
        <div class="card-head"><h3>R${robot.id}</h3>${stateBadge(robot.state)}</div>
        <div class="card-body inspector">
          <div class="kv">
            <b>位置</b><span>(${robot.position.x}, ${robot.position.y})</span>
            <b>当前订单</b><span>${robot.order_id ? `#${robot.order_id}` : '—'}</span>
            <b>当前任务</b><span>${taskLabel(robot)}</span>
            <b>已行驶</b><span>${robot.distance ?? 0} steps</span>
            <b>电量</b><span>${extra.battery ?? '—'}%</span>
            <b>利用率</b><span>${percent(extra.utilization)}</span>
            <b>预计完成</b><span>${robot.path?.length ? `${robot.path.length} tick` : '—'}</span>
          </div>
          ${pathViz ? `<div class="path-viz">${pathViz}</div>` : ''}
        </div>`;
    } else if (sel.kind === 'order') {
      const order = world.orders?.[sel.orderId];
      if (!order) { container.innerHTML = ''; return; }
      body = `
        <div class="card-head"><h3>订单 #${order.id}</h3>${stateBadge(order.state)}</div>
        <div class="card-body inspector">
          <div class="kv">
            <b>优先级</b><span>${order.priority}</span>
            <b>取货点</b><span>(${order.pickup.x}, ${order.pickup.y})</span>
            <b>送货点</b><span>(${order.dropoff.x}, ${order.dropoff.y})</span>
            <b>分配机器人</b><span>${order.robot_id ? `R${order.robot_id}` : '—'}</span>
          </div>
        </div>`;
    } else if (sel.kind === 'cell') {
      const x = sel.x;
      const y = sel.y;
      const shelf = world.map.obstacles.some((p) => p.x === x && p.y === y);
      const blocked = world.map.blocked.some((p) => p.x === x && p.y === y);
      const heat = world.heatmap?.[y]?.[x] ?? 0;
      body = `
        <div class="card-head"><h3>格子 (${x}, ${y})</h3><span class="tag">地图</span></div>
        <div class="card-body inspector">
          <div class="kv">
            <b>地形</b><span>${shelf ? '货架障碍' : blocked ? '通道封锁' : '可通行'}</span>
            <b>热力</b><span>${heat} tick</span>
          </div>
        </div>`;
    }
    container.innerHTML = `<div class="card" style="margin-bottom:12px">${body}</div>`;
  };

  const unsub = store.subscribe((tag) => { if (tag === 'select' || tag === 'world' || tag === 'state') draw(); });
  draw();
  return unsub;
}

function taskLabel(robot) {
  if (robot.state === 'to_pickup') return '前往取货点';
  if (robot.state === 'to_dropoff') return '前往送货点';
  if (robot.state === 'faulted') return '故障停机';
  return '空闲待命';
}

// ---------- Agent 决策面板 ----------
export function renderAgentDecision(container) {
  const draw = () => {
    const decisions = store.agentDecisions || [];
    if (!decisions.length) {
      const msg = store.mockMode
        ? '演示模式 · 暂无决策记录'
        : store.backend === 'agent'
          ? '暂无决策记录 · 运行几步后生成'
          : 'Agent 未接入 · 当前为仿真核心，切换到 Agent 后端查看决策轨迹';
      container.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }
    const d = decisions[0];
    const source = store.mockMode ? '演示数据' : store.backend === 'agent' ? 'Rule 策略' : '仿真';
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div><div style="font-size:13px;font-weight:650">${escapeHtml(d.title)}</div>
        <div style="color:var(--text-3);font-size:11px">t ${d.tick}${d.robotId ? ` · R${d.robotId}` : ''}</div></div>
        <span class="tag">${source}</span>
      </div>
      <ol style="margin:0 0 12px;padding-left:0;list-style:none;counter-reset:s">
        ${(d.steps || []).map((s, i) => `<li style="display:flex;gap:10px;padding:5px 0;color:var(--text-2);font-size:12.5px"><span style="color:var(--primary);font-weight:650;min-width:16px">${i + 1}</span>${escapeHtml(s)}</li>`).join('') || '<li style="color:var(--text-3)">（无工具调用）</li>'}
      </ol>
      ${(d.reasons || []).length ? `<div style="border-top:1px solid var(--border);padding-top:10px">
        <div style="color:var(--text-3);font-size:11px;margin-bottom:6px">决策原因</div>
        ${(d.reasons || []).map((r) => `<div style="display:flex;gap:7px;color:var(--text-2);font-size:12px;padding:2px 0"><span style="color:var(--success)">✓</span>${escapeHtml(r)}</div>`).join('')}
      </div>` : ''}`;
  };
  const unsub = store.subscribe((tag) => { if (tag === 'agent' || tag === 'world' || tag === 'state') draw(); });
  draw();
  return unsub;
}

// ---------- 底部机器人卡片列表（替代原表格，竖向卡片 + 3D 图标 + 电量条） ----------
export function renderRobotTable(container) {
  const draw = () => {
    const robots = values(store.world?.robots || {}).sort((a, b) => a.id - b.id);
    container.innerHTML = `<div class="robot-cards">${robots.map((r) => {
      const e = store.extras[r.id] || {};
      const sel = store.selected?.kind === 'robot' && store.selected.robotId === r.id ? 'sel' : '';
      const color = robotStatusColor(r);
      const battery = e.battery ?? 0;
      const batteryColor = battery < 25 ? 'var(--danger)' : battery < 50 ? 'var(--warning)' : 'var(--primary)';
      return `
      <div class="robot-card ${sel}" data-robot="${r.id}" style="--rc-c:${color}">
        <div class="rc-icon">${robotIcon(color)}</div>
        <div class="rc-head">
          <div class="rc-name">R${r.id}</div>
          ${stateBadge(r.state)}
        </div>
        <div class="rc-grid">
          <div class="m">订单<b>${r.order_id ? `#${r.order_id}` : '—'}</b></div>
          <div class="m">位置<b>(${r.position.x},${r.position.y})</b></div>
          <div class="m">利用率<b>${percent(e.utilization)}</b></div>
          <div class="m">预计<b>${r.path?.length ? `${r.path.length}tick` : '—'}</b></div>
        </div>
        <div class="rc-battery">
          <div class="lbl">电量<b>${battery}%</b></div>
          <div class="bar"><i style="width:${battery}%;background:${batteryColor}"></i></div>
        </div>
      </div>`;
    }).join('') || '<div class="empty">暂无机器人</div>'}</div>`;
  };
  const unsub = store.subscribe((tag) => { if (tag === 'world' || tag === 'state' || tag === 'select') draw(); });
  draw();
  return unsub;
}

export function renderOrderTable(container) {
  const draw = () => {
    const orders = values(store.world?.orders || {}).sort((a, b) => b.id - a.id).slice(0, 80);
    container.innerHTML = `<table class="tbl"><thead><tr>
      <th>订单号</th><th>状态</th><th>优先级</th><th>取货</th><th>送货</th><th>机器人</th>
    </tr></thead><tbody>
    ${orders.map((o) => `<tr>
      <td>#${o.id}</td><td>${stateBadge(o.state)}</td><td>${o.priority}</td>
      <td>(${o.pickup.x}, ${o.pickup.y})</td><td>(${o.dropoff.x}, ${o.dropoff.y})</td>
      <td>${o.robot_id ? `R${o.robot_id}` : '—'}</td>
    </tr>`).join('')}
    </tbody></table>`;
  };
  const unsub = store.subscribe((tag) => { if (tag === 'world' || tag === 'state') draw(); });
  draw();
  return unsub;
}

// ---------- 事件日志（完整） ----------
export function renderEventLog(container) {
  const draw = () => {
    const events = (store.world?.events || []).slice(-100).reverse();
    container.innerHTML = `<ul class="event-list">${events.map((ev) => {
      const label = EVENT_LABEL[ev.kind] || ev.kind;
      const tone = EVENT_TONE[ev.kind] || 'info';
      return `<li><span class="t">t${ev.tick}</span><span class="k ${tone}">${label}</span><span>${escapeHtml(ev.detail)}${ev.robot_id ? ` · R${ev.robot_id}` : ''}${ev.order_id ? ` · #${ev.order_id}` : ''}</span></li>`;
    }).join('') || '<li style="color:var(--text-3)">暂无事件</li>'}</ul>`;
  };
  const unsub = store.subscribe((tag) => { if (tag === 'world' || tag === 'state') draw(); });
  draw();
  return unsub;
}

// ---------- Tabs ----------
export function tabBar(container, tabs, activeKey, onChange) {
  container.innerHTML = `<div class="tabs">${tabs.map((t) => `<button class="tab ${t.key === activeKey ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}</div>`;
  container.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      onChange(btn.dataset.tab);
    });
  });
  return {
    setActive(key) {
      container.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    },
  };
}

// ---------- Modal ----------
export function openModal({ title, body, actions }) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal">
    <div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="icon-btn" data-close>${icon('close')}</button></div>
    <div class="modal-body">${body}</div>
    ${actions ? `<div class="modal-foot">${actions}</div>` : ''}
  </div>`;
  const close = () => mask.remove();
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  mask.querySelector('[data-close]').addEventListener('click', close);
  document.body.appendChild(mask);
  return { close, mask };
}
