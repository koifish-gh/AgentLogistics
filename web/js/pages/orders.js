// 页面：订单调度 —— 状态筛选 + 搜索 + 排序 + 订单表 + 手动派单

import { store } from '../store.js';
import { values, $ } from '../util.js';
import { stateBadge, openModal } from '../components/widgets.js';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待分配' },
  { key: 'transit', label: '运输中' },
  { key: 'completed', label: '已完成' },
  { key: 'abnormal', label: '异常' },
];

export function mount(container) {
  let filter = 'all';
  let search = '';
  let sort = 'id_desc';

  container.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div class="seg" id="orderFilter">
          ${FILTERS.map((f) => `<button data-f="${f.key}" class="${f.key === 'all' ? 'active' : ''}">${f.label}</button>`).join('')}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="orderSearch" type="text" placeholder="搜索订单号…" style="width:160px" />
          <select id="orderSort">
            <option value="id_desc">订单号 ↓</option>
            <option value="id_asc">订单号 ↑</option>
            <option value="priority_desc">优先级 ↓</option>
            <option value="priority_asc">优先级 ↑</option>
          </select>
        </div>
      </div>
      <div class="card-body flush">
        <div id="orderTableWrap" style="max-height:calc(100vh - 220px);overflow:auto"></div>
      </div>
    </div>`;

  $('#orderFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    filter = btn.dataset.f;
    container.querySelectorAll('#orderFilter button').forEach((b) => b.classList.toggle('active', b === btn));
    draw();
  });
  $('#orderSearch').addEventListener('input', (e) => { search = e.target.value.trim(); draw(); });
  $('#orderSort').addEventListener('change', (e) => { sort = e.target.value; draw(); });

  // 手动派单：点击「分配」后选择空闲机器人
  $('#orderTableWrap').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-assign]');
    if (btn) openAssignModal(Number(btn.dataset.assign));
  });

  const openAssignModal = (orderId) => {
    const idle = values(store.world?.robots || {}).filter((r) => r.state === 'idle');
    const order = store.world?.orders?.[orderId];
    if (!order) return;
    const body = idle.length
      ? `<div style="display:flex;flex-direction:column;gap:8px">
          ${idle.map((r) => `
            <button class="inject-item" data-robot="${r.id}" style="display:flex;align-items:center;gap:11px;padding:11px;border:1px solid var(--border);border-radius:9px;background:var(--surface-2);text-align:left;width:100%;cursor:pointer">
              <span style="font-weight:700;min-width:28px">R${r.id}</span>
              <span style="flex:1;color:var(--text-2);font-size:12px">位置 (${r.position.x}, ${r.position.y}) · 已完成 ${r.completed_orders} 单</span>
            </button>`).join('')}
        </div>`
      : '<div class="empty">当前没有空闲机器人</div>';
    const modal = openModal({ title: `分配订单 #${orderId}`, body });
    modal.mask.querySelectorAll('[data-robot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.close();
        store.assignOrder(Number(btn.dataset.robot), orderId).catch((err) => store.notify('error', err));
      });
    });
  };

  const matches = (o) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return o.state === 'pending';
    if (filter === 'transit') return o.state === 'assigned' || o.state === 'in_transit';
    if (filter === 'completed') return o.state === 'completed';
    if (filter === 'abnormal') return !!o.recovery_from;
    return true;
  };

  const draw = () => {
    let orders = values(store.world?.orders || {}).filter((o) => matches(o));
    if (search) orders = orders.filter((o) => String(o.id).includes(search));
    const dir = sort.endsWith('_asc') ? 1 : -1;
    const key = sort.replace(/_(asc|desc)$/, '');
    orders.sort((a, b) => (key === 'priority' ? (a.priority - b.priority) : (a.id - b.id)) * dir);

    $('#orderTableWrap').innerHTML = `<table class="tbl"><thead><tr>
      <th>订单号</th><th>优先级</th><th>状态</th><th>取货点</th><th>送货点</th><th>分配机器人</th><th>预计完成</th><th>操作</th>
    </tr></thead><tbody>
    ${orders.map((o) => {
      const robot = o.robot_id ? store.world.robots?.[o.robot_id] : null;
      const eta = robot?.path?.length ? `${robot.path.length} tick` : '—';
      const action = o.state === 'pending'
        ? `<button class="btn sm accent" data-assign="${o.id}">分配</button>`
        : '<span class="tag">—</span>';
      return `<tr>
        <td style="font-weight:650">#${o.id}</td>
        <td>${o.priority}</td>
        <td>${stateBadge(o.state)}</td>
        <td>(${o.pickup.x}, ${o.pickup.y})</td>
        <td>(${o.dropoff.x}, ${o.dropoff.y})</td>
        <td>${o.robot_id ? `R${o.robot_id}` : '—'}</td>
        <td>${eta}</td>
        <td>${action}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">暂无匹配订单</td></tr>'}
    </tbody></table>`;
  };

  const unsub = store.subscribe((tag) => { if (tag === 'world' || tag === 'state') draw(); });
  draw();
  return unsub;
}
