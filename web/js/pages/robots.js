// 页面：机器人管理 —— 机器人卡片 + 状态筛选 + 详情弹窗

import { store } from '../store.js';
import { values, percent, $ } from '../util.js';
import { stateBadge, openModal, robotIcon } from '../components/widgets.js';
import { robotStatusColor } from '../constants.js';
import { sparkline } from '../charts.js';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'moving', label: '运输中' },
  { key: 'idle', label: '空闲' },
  { key: 'faulted', label: '故障' },
];

export function mount(container) {
  let filter = 'all';
  container.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-body">
        <div class="seg" id="robotFilter" style="margin-bottom:12px">
          ${FILTERS.map((f) => `<button data-f="${f.key}" class="${f.key === 'all' ? 'active' : ''}">${f.label}</button>`).join('')}
        </div>
        <div class="robot-cards" id="robotCards"></div>
      </div>
    </div>`;

  $('#robotFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    filter = btn.dataset.f;
    container.querySelectorAll('#robotFilter button').forEach((b) => b.classList.toggle('active', b === btn));
    draw();
  });

  const draw = () => {
    const robots = values(store.world?.robots || {}).sort((a, b) => a.id - b.id).filter((r) => {
      if (filter === 'all') return true;
      if (filter === 'faulted') return r.state === 'faulted';
      if (filter === 'idle') return r.state === 'idle';
      return r.state === 'to_pickup' || r.state === 'to_dropoff';
    });
    const grid = $('#robotCards');
    grid.innerHTML = robots.map((r) => {
      const e = store.extras[r.id] || {};
      const task = r.state === 'to_pickup' ? '前往取货点' : r.state === 'to_dropoff' ? '前往送货点' : r.state === 'faulted' ? '故障停机' : '空闲待命';
      const color = robotStatusColor(r);
      const battery = e.battery ?? 0;
      const batteryColor = battery < 25 ? 'var(--danger)' : battery < 50 ? 'var(--warning)' : 'var(--primary)';
      return `
      <div class="robot-card" data-robot="${r.id}" style="--rc-c:${color};cursor:pointer">
        <div class="rc-icon">${robotIcon(color)}</div>
        <div class="rc-head">
          <div class="rc-name">R${r.id}</div>
          ${stateBadge(r.state)}
        </div>
        <div class="rc-grid">
          <div class="m">订单<b>${r.order_id ? `#${r.order_id}` : '—'}</b></div>
          <div class="m">任务<b>${task}</b></div>
          <div class="m">位置<b>(${r.position.x},${r.position.y})</b></div>
          <div class="m">利用率<b>${percent(e.utilization)}</b></div>
        </div>
        <div class="rc-battery">
          <div class="lbl">电量<b>${battery}%</b></div>
          <div class="bar"><i style="width:${battery}%;background:${batteryColor}"></i></div>
        </div>
      </div>`;
    }).join('') || '<div class="empty">暂无匹配机器人</div>';

    grid.querySelectorAll('[data-robot]').forEach((card) => {
      card.addEventListener('click', () => openDetail(Number(card.dataset.robot)));
    });
  };

  const openDetail = (id) => {
    const r = store.world?.robots?.[id];
    if (!r) return;
    const e = store.extras[id] || {};
    const path = r.path || [];
    const body = `
      <div class="inspector">
        <div class="kv" style="grid-template-columns:96px 1fr">
          <b>运动状态</b><span>${stateBadge(r.state)}</span>
          <b>位置</b><span>(${r.position.x}, ${r.position.y})</span>
          <b>当前订单</b><span>${r.order_id ? `#${r.order_id}` : '—'}</span>
          <b>完成订单</b><span>${r.completed_orders}</span>
          <b>平均任务时间</b><span>${e.avgTaskTime ?? '—'} tick</span>
          <b>累计距离</b><span>${r.distance ?? 0} steps</span>
          <b>等待 tick</b><span>${r.wait_ticks ?? 0}</span>
          <b>当前路径</b><span>${path.length ? path.map((p) => `(${p.x},${p.y})`).join(' → ') : '—'}</span>
        </div>
        <div style="margin-top:14px">
          <div style="color:var(--text-3);font-size:11px;margin-bottom:6px">历史利用率</div>
          <div class="chart-box" style="height:80px"><canvas id="robotHist"></canvas></div>
        </div>
      </div>`;
    const modal = openModal({ title: `机器人 R${id}`, body });
    requestAnimationFrame(() => {
      const c = modal.mask.querySelector('#robotHist');
      if (c) sparkline(c, e.history || [], '#2cc6b0', { fill: true });
    });
  };

  const unsub = store.subscribe((tag) => { if (tag === 'world' || tag === 'state') draw(); });
  draw();
  return unsub;
}
