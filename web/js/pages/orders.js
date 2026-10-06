// 页面：订单调度。筛选、排序、分页和手动分配都走现有状态与 assign_order。

import { store } from '../store.js';
import { values, escapeHtml, $ } from '../util.js';
import { stateBadge, openModal } from '../components/widgets.js';
import { STATE_LABEL } from '../constants.js';
import { statCards, emptyState } from '../components/ui.js';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待分配' },
  { key: 'assigned', label: '已分配' },
  { key: 'in_transit', label: '运输中' },
  { key: 'completed', label: '已完成' },
  { key: 'abnormal', label: '异常' },
];
const PAGE_SIZE = 10;

function etaText(order) {
  const robot = order.robot_id ? store.world?.robots?.[order.robot_id] : null;
  if (!robot?.path?.length) return '—';
  return `${robot.path.length} tick`;
}

function progressText(order) {
  if (order.recovery_from) return `故障接运，货物位于 (${order.recovery_from.x}, ${order.recovery_from.y})`;
  if (order.state === 'pending') return '等待分配给空闲机器人';
  if (order.state === 'assigned') return '已分配，机器人正在前往取货点';
  if (order.state === 'in_transit') return '已取货，正在送往送货点';
  if (order.state === 'completed' && order.completed_at != null) return `已完成，用时 ${order.completed_at - order.created_at} tick`;
  if (order.state === 'completed') return '已完成';
  return STATE_LABEL[order.state] || order.state;
}

export function mount(container) {
  let filter = 'all';
  let keyword = '';
  let sort = 'priority_desc';
  let page = 1;
  let assigningId = 0;

  container.innerHTML = `
    <div class="page-stack">
      <div id="orderStats"></div>
      <div class="card">
        <div class="card-body toolbar">
          <div class="seg" id="orderFilter">
            ${FILTERS.map((item) => `<button data-f="${item.key}" class="${item.key === 'all' ? 'active' : ''}">${item.label}</button>`).join('')}
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn sm primary" id="orderCreate" type="button">创建订单</button>
            <input id="orderSearch" type="text" placeholder="搜索订单号" style="width:140px" />
            <select id="orderSort">
              <option value="priority_desc">优先级从高到低</option>
              <option value="priority_asc">优先级从低到高</option>
              <option value="id_desc">订单号从新到旧</option>
              <option value="id_asc">订单号从旧到新</option>
            </select>
          </div>
        </div>
        <div class="card-body flush" id="orderTable"></div>
        <div class="pager" id="orderPager"></div>
      </div>
    </div>`;

  $('#orderFilter').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    filter = button.dataset.f;
    page = 1;
    container.querySelectorAll('#orderFilter button').forEach((item) => item.classList.toggle('active', item === button));
    draw();
  });
  $('#orderCreate').addEventListener('click', () => store.beginOrderDraft());
  $('#orderSearch').addEventListener('input', (event) => { keyword = event.target.value.trim(); page = 1; draw(); });
  $('#orderSort').addEventListener('change', (event) => { sort = event.target.value; draw(); });
  $('#orderTable').addEventListener('click', (event) => {
    const assign = event.target.closest('[data-assign]');
    if (assign) {
      openAssign(Number(assign.dataset.assign));
      return;
    }
    const locate = event.target.closest('[data-locate]');
    if (locate) {
      store.requestFocus({ kind: 'order', orderId: Number(locate.dataset.locate) });
      return;
    }
    const row = event.target.closest('[data-order]');
    if (row) openDetail(Number(row.dataset.order));
  });
  $('#orderPager').addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button) return;
    page = Number(button.dataset.page);
    draw();
  });

  const matches = (order) => {
    if (keyword && !String(order.id).includes(keyword)) return false;
    if (filter === 'all') return true;
    if (filter === 'abnormal') return !!order.recovery_from;
    return order.state === filter;
  };

  const draw = () => {
    const summary = store.summary();
    $('#orderStats').innerHTML = statCards([
      { label: '全部订单', value: summary.orders },
      { label: '待分配', value: summary.pending, tone: summary.pending ? 'warn' : '' },
      { label: '已分配', value: summary.assigned, tone: 'info' },
      { label: '运输中', value: summary.inTransit, tone: 'brand' },
      { label: '已完成', value: summary.completed, tone: 'ok' },
      { label: '异常', value: summary.abnormal, hint: '存在接运位置', tone: summary.abnormal ? 'bad' : '' },
    ]);

    let orders = values(store.world?.orders || {}).filter(matches);
    const direction = sort.endsWith('_asc') ? 1 : -1;
    const key = sort.startsWith('priority') ? 'priority' : 'id';
    orders.sort((a, b) => ((a[key] - b[key]) || (a.id - b.id)) * direction);
    const pages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
    page = Math.min(page, pages);
    const view = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    $('#orderTable').innerHTML = `<table class="tbl"><thead><tr>
      <th>订单编号</th><th>优先级</th><th>状态</th><th>取货点</th><th>送货点</th><th>分配机器人</th><th>预计完成</th><th>操作</th>
    </tr></thead><tbody>
    ${view.map((order) => {
      const busy = assigningId === order.id;
      const action = order.state === 'pending'
        ? `<button class="btn sm accent" data-assign="${order.id}" ${busy ? 'disabled' : ''}>${busy ? '分配中…' : '分配'}</button>`
        : `<button class="btn sm" data-locate="${order.id}">查看路径</button>`;
      return `<tr class="clickable" data-order="${order.id}">
        <td>#${order.id}</td>
        <td>${order.priority}</td>
        <td>${stateBadge(order.state)}</td>
        <td>(${order.pickup.x}, ${order.pickup.y})</td>
        <td>(${order.dropoff.x}, ${order.dropoff.y})</td>
        <td>${order.robot_id ? `R${order.robot_id}` : '—'}</td>
        <td>${etaText(order)}</td>
        <td>${action}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="8">${emptyState('没有匹配的订单', '可以生成订单，或更换筛选条件。')}</td></tr>`}
    </tbody></table>`;

    $('#orderPager').innerHTML = `
      <span>第 ${page} / ${pages} 页 · 共 ${orders.length} 条</span>
      <span style="display:flex;gap:6px">
        <button class="btn sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="btn sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>下一页</button>
      </span>`;
  };

  const openDetail = (orderId) => {
    const order = store.world?.orders?.[orderId];
    if (!order) return;
    const robot = order.robot_id ? store.world.robots?.[order.robot_id] : null;
    const modal = openModal({
      title: `订单 #${order.id}`,
      body: `<div class="inspector"><div class="kv">
        <b>状态</b><span>${stateBadge(order.state)}</span>
        <b>优先级</b><span>${order.priority}</span>
        <b>进度</b><span>${escapeHtml(progressText(order))}</span>
        <b>取货点</b><span>(${order.pickup.x}, ${order.pickup.y})</span>
        <b>送货点</b><span>(${order.dropoff.x}, ${order.dropoff.y})</span>
        <b>机器人</b><span>${robot ? `R${robot.id} · ${STATE_LABEL[robot.state] || robot.state}` : '—'}</span>
        <b>剩余路径</b><span>${robot?.path?.length ? `${robot.path.length} 格` : '—'}</span>
        <b>创建 tick</b><span>${order.created_at ?? '—'}</span>
        <b>完成 tick</b><span>${order.completed_at ?? '—'}</span>
      </div></div>`,
      actions: `<button class="btn" data-close-detail>关闭</button><button class="btn primary" data-go>在地图中查看</button>`,
    });
    modal.mask.querySelector('[data-close-detail]').addEventListener('click', () => modal.close());
    modal.mask.querySelector('[data-go]').addEventListener('click', () => {
      modal.close();
      store.requestFocus({ kind: 'order', orderId: order.id });
    });
  };

  const openAssign = (orderId) => {
    const order = store.world?.orders?.[orderId];
    if (!order || order.state !== 'pending') return;
    const idle = values(store.world?.robots || {}).filter((robot) => robot.state === 'idle');
    const modal = openModal({
      title: `分配订单 #${orderId}`,
      body: idle.length ? `<div style="display:flex;flex-direction:column;gap:8px">${idle.map((robot) => `
        <button class="btn" data-robot="${robot.id}" style="justify-content:space-between">
          <span>R${robot.id}</span><span class="note">(${robot.position.x}, ${robot.position.y}) · 已完成 ${robot.completed_orders ?? 0} 单</span>
        </button>`).join('')}</div>` : emptyState('没有空闲机器人', '只有空闲机器人可以接收待分配订单。'),
    });
    modal.mask.querySelectorAll('[data-robot]').forEach((button) => {
      button.addEventListener('click', async () => {
        const robotId = Number(button.dataset.robot);
        modal.close();
        assigningId = orderId;
        draw();
        try {
          await store.assignOrder(robotId, orderId);
          store.notify('toast', `订单 #${orderId} 已分配给 R${robotId}`);
        } catch (error) {
          store.notify('error', error);
        } finally {
          assigningId = 0;
          draw();
        }
      });
    });
  };

  const unsub = store.subscribe((tag) => { if (tag === 'world' || tag === 'state') draw(); });
  draw();
  return unsub;
}
