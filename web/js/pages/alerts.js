import { describeAlert } from '../alert-content.mjs';
import { store } from '../store.js';
import { alerts, subscribeAlerts, acknowledgeAlert, setAlertStandards, analyzeAlert } from '../alerts.js';
import { escapeHtml } from '../util.js';

export function mount(container) {
  let filter = 'active';
  let disposed = false;
  const repairing = new Set();
  container.innerHTML = `<section class="card"><div class="card-head"><h3>告警中心</h3><span>确认处理 ≠ 修复完成</span></div><div class="card-body">
    <p class="note">仅监测已连接的真实仿真。新故障立即提示，执行任务的机器人连续等待达到阈值时预警；同一异常持续期间不重复提醒。</p>
    <div id="alertSummary" class="alert-summary"></div>
    <div class="alert-toolbar"><label for="waitThreshold">拥堵预警阈值（仿真 tick）</label><input id="waitThreshold" type="number" min="3" max="1000" value="${alerts.threshold}"></div><div class="alert-standards"><label>全局告警：同时故障台数<input id="criticalFaultCount" type="number" min="1" max="64" value="${alerts.criticalFaultCount}"></label><label>全局告警：单车连续等待 tick<input id="criticalWait" type="number" min="4" max="10000" value="${alerts.criticalWait}"></label></div><div class="alert-toolbar"><button id="saveThreshold" class="btn sm primary">保存告警标准</button><button id="refreshAlerts" class="btn sm">刷新状态</button></div>
    <p class="note">普通预警弹窗提醒；以上两项全局标准任一满足时，页面四周显示红色荧光并出现中央警告。确认告警不会消除风险，只有恢复或不再满足标准才解除。时间单位为仿真 tick，暂停不累计。默认标准用于演示，可按场景修改。</p>
    <div class="alert-filters"><button class="btn sm active" data-filter="active">处理中</button><button class="btn sm" data-filter="unack">未确认</button><button class="btn sm" data-filter="resolved">已结束</button><button class="btn sm" data-filter="all">全部</button></div>
    <p id="alertConnectivity" class="note"></p><div id="alertRecords" aria-live="polite"></div>
    <p class="note">告警和确认记录保存在本浏览器，刷新后保留；不同设备不共享。最多保留约 200 条历史记录。尚未发送外部消息。</p>
    </div></section>`;
  const draw = () => {
    const active = alerts.records.filter(r => !r.resolved);
    const faults = active.filter(r => r.type === 'fault').length;
    const critical = alerts.critical();
    container.querySelector('#alertSummary').classList.toggle('critical', critical.active);
    container.querySelector('#alertSummary').textContent = (critical.active ? '全局严重告警 · ' : '普通监测 · ') + `故障 ${faults} · 持续等待 ${active.length - faults} · 未确认 ${active.filter(r => !r.acknowledged).length} · 已结束 ${alerts.records.filter(r => r.resolved).length}`;
    container.querySelector('#alertConnectivity').textContent = store.mockMode || !store.connected ? '后端未连接：以下为历史记录，当前状态待核实。' : `已连接 · 当前 tick ${store.world?.tick ?? 0}`;
    const records = [...alerts.records].reverse().filter(r => filter === 'all' || (filter === 'active' && !r.resolved) || (filter === 'unack' && !r.resolved && !r.acknowledged) || (filter === 'resolved' && r.resolved));
    container.querySelector('#alertRecords').innerHTML = records.map(r => `<article data-alert-id="${escapeHtml(r.id)}" class="alert-record ${r.resolved ? 'resolved' : r.type}">
      <div class="alert-record-head"><h3>${r.type === 'fault' ? '故障停机' : '持续等待'} · R${r.robotId}</h3><b>${r.resolved ? '已结束' : r.acknowledged ? '已确认 · 待处理' : '未确认'}</b></div>
      <p>位置 (${r.position.x}, ${r.position.y}) · 发生 tick ${r.startTick} · 检测 tick ${r.detectedTick}${r.orderId ? ` · 相关订单 #${r.orderId}` : ''}${r.sequence != null ? ` · 事件 #${r.sequence}` : ''}</p>
      <p>${r.type === 'fault' ? '来源为仿真故障注入，未记录机械根因。请安排人工修复，原任务可能已退回待分配。' : `当前记录连续等待 ${r.waits} tick。请检查通道占用、封路和目标可达性，可在分析助手中询问。`}</p>
      ${r.resolved ? `<p>${escapeHtml(r.resolution)} · 结束 tick ${r.endTick}</p>` : `<div class="alert-actions">${!r.acknowledged ? `<button class="btn sm" data-ack="${escapeHtml(r.id)}">确认处理</button>` : ''}${r.type === 'fault' ? `<button class="btn sm primary" data-repair="${escapeHtml(r.id)}" ${repairing.has(r.id) || !store.connected || store.mockMode ? 'disabled' : ''}>${repairing.has(r.id) ? '修复中…' : '修复机器人'}</button>` : ''}<button class="btn sm" data-locate="${r.robotId}">地图定位</button><button class="btn sm" data-analyze="${escapeHtml(r.id)}">分析此告警</button></div>`}
    </article>`).join('') || '<p class="empty">当前筛选下没有告警。</p>';
  };
  container.querySelector('#saveThreshold').onclick = () => {
    try { setAlertStandards({ threshold: container.querySelector('#waitThreshold').value, criticalFaultCount: container.querySelector('#criticalFaultCount').value, criticalWait: container.querySelector('#criticalWait').value }); store.notify('toast', '告警阈值已更新'); } catch (e) { store.notify('error', e); }
  };
  container.querySelector('#refreshAlerts').onclick = async () => { try { await store.reload(); } catch(e) { store.notify('error', e); } };
  container.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.filter) { filter = button.dataset.filter; container.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === button)); draw(); }
    if (button.dataset.ack) acknowledgeAlert(button.dataset.ack);
    if (button.dataset.analyze) { const record = alerts.records.find(r => r.id === button.dataset.analyze); if (record) analyzeAlert(describeAlert(record, store.world, alerts).question); }
    if (button.dataset.locate) { store.requestFocus({ kind: 'robot', robotId: Number(button.dataset.locate) }); location.hash = '/'; }
    if (button.dataset.repair) {
      const record = alerts.records.find(r => r.id === button.dataset.repair);
      if (!record || record.resolved || repairing.has(record.id)) return;
      repairing.add(record.id); draw();
      try { await store.injectSceneEvent('robot_repair', { robotId: record.robotId }); }
      catch(e) { store.notify('error', e); }
      finally { repairing.delete(record.id); if (!disposed) draw(); }
    }
  });
  const focusAlert = () => {
    const id = sessionStorage.getItem('al-alert-focus'); if (!id) return;
    sessionStorage.removeItem('al-alert-focus'); filter = 'all';
    container.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
    draw();
    const row = [...container.querySelectorAll('[data-alert-id]')].find(el => el.dataset.alertId === id);
    if (row) { row.classList.add('alert-focused'); row.tabIndex = -1; row.scrollIntoView({block:'center', behavior:'smooth'}); row.focus({preventScroll:true}); }
  };
  // Preserve clicked nodes until the click has completed while simulation updates arrive.
  let pointerBusy = false, pendingDraw = false;
  const refresh = () => { if (pointerBusy) pendingDraw = true; else draw(); };
  const release = () => { pointerBusy = false; setTimeout(() => { if (!disposed && pendingDraw) { pendingDraw = false; draw(); } }, 0); };
  container.addEventListener('pointerdown', () => { pointerBusy = true; });
  window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
  window.addEventListener('alert-focus', focusAlert);
  const unsubscribe = subscribeAlerts(refresh);
  const unstore = store.subscribe(tag => { if (tag === 'state' || tag === 'world') refresh(); });
  draw(); focusAlert(); return () => { disposed = true; unsubscribe(); unstore(); window.removeEventListener('alert-focus', focusAlert); window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); };
}
