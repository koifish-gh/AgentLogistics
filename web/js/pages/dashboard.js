// 页面：总览。统计、可交互仓库地图、仿真控制和底部分页信息。

import { IsoMap } from '../isoMap.js';
import { store } from '../store.js';
import { icon, $ } from '../util.js';
import { lineChart } from '../charts.js';
import { statCards } from '../components/ui.js';
import {
  renderKpi, renderSimControl, renderEventPanel,
  renderRobotTable, renderOrderTable, renderEventLog, renderAgentDecision, tabBar,
} from '../components/widgets.js';

const TOGGLES = [
  { key: 'paths', label: '路径' },
  { key: 'orders', label: '订单点' },
  { key: 'heat', label: '热力图' },
  { key: 'congestion', label: '拥堵' },
  { key: 'fault', label: '故障' },
  { key: 'grid', label: '坐标' },
];

export function mount(container) {
  container.classList.add('page-lock');
  container.innerHTML = `
    <div class="dash">
      <div class="dash-screen">
      <div id="dashStats"></div>
      <div class="dash-main">
        <div class="card map-card">
          <div class="card-head">
            <h3>仓储数字孪生</h3>
            <span class="sub" id="mapMeta">等待地图数据</span>
          </div>
          <p class="note map-decision" id="mapDecision">关键事件出现后，派单、绕行和故障改派会写在这里。</p>
          <div class="map-wrap" id="mapWrap">
            <canvas id="warehouse"></canvas>
            <div class="map-toggles" id="mapToggles"></div>
            <div class="map-controls">
              <div class="map-presets" id="mapPresets">
                <button class="icon-btn text active" data-view="default" title="等距视角">等距</button>
                <button class="icon-btn text" data-view="top" title="俯视">俯视</button>
                <button class="icon-btn text" data-view="side" title="低角度侧视">侧视</button>
              </div>
              <div class="map-tools">
                <button class="icon-btn" id="mZoomIn" title="放大">${icon('zoomin')}</button>
                <button class="icon-btn" id="mZoomOut" title="缩小">${icon('zoomout')}</button>
                <button class="icon-btn" id="mFit" title="适应仓库">${icon('fullscreen')}</button>
                <button class="icon-btn" id="mReset" title="恢复默认视角">${icon('reset')}</button>
                <button class="icon-btn" id="mFull" title="全屏">${icon('layers')}</button>
              </div>
            </div>
            <div class="map-legend">
              <span><i class="lg-shelf"></i>货架</span>
              <span><i class="lg-pick"></i>取货点</span>
              <span><i class="lg-drop"></i>送货点</span>
              <span><i class="lg-path"></i>路径按机器人区分</span>
              <span><i class="lg-congestion"></i>拥堵</span>
              <span><i class="lg-fault"></i>故障</span>
            </div>
            <div class="segment-banner" id="segmentBanner" hidden>
              <span id="segmentBannerText"></span>
              <button class="btn sm" id="segmentCancel" type="button">取消</button>
            </div>
            <form class="order-draft" id="orderDraft" hidden>
              <p class="order-draft-hint" id="orderDraftHint">先点取货点，再点送货点。也可以直接填写坐标。</p>
              <label>订单数<input id="orderDraftCount" type="number" min="1" max="100" value="1"></label>
              <label class="aim" data-aim="pickup">取货
                <input id="orderPickX" type="number" inputmode="numeric" aria-label="取货点 x">
                <input id="orderPickY" type="number" inputmode="numeric" aria-label="取货点 y">
              </label>
              <label class="aim" data-aim="dropoff">送货
                <input id="orderDropX" type="number" inputmode="numeric" aria-label="送货点 x">
                <input id="orderDropY" type="number" inputmode="numeric" aria-label="送货点 y">
              </label>
              <button class="btn sm primary" id="orderDraftOk" type="submit">确认创建</button>
              <button class="btn sm" id="orderDraftCancel" type="button">取消</button>
            </form>
          </div>
        </div>
        <div class="dash-side">
          <div class="card"><div class="card-head"><h3>运行指标</h3><span class="sub">与顶部状态同源</span></div><div class="card-body" id="kpiBox"></div></div>
          <div class="card dash-sim"><div class="card-head"><h3>仿真控制</h3></div><div class="card-body" id="simBox"></div></div>
        </div>
      </div>
      </div>
      <div class="card bottom-tabs">
        <div id="bottomTabs"></div>
        <div class="bottom-body" id="bottomBody"></div>
      </div>
    </div>`;

  const map = new IsoMap($('#warehouse'), { store, onSelect: (sel) => store.select(sel) });
  const presetsEl = $('#mapPresets');
  const setPresetActive = (preset) => {
    presetsEl.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === preset);
    });
  };

  const drawDecision = () => {
    const line = $('#mapDecision');
    if (!line) return;
    const decision = (store.agentDecisions || [])[0];
    if (store.deciding) {
      const name = store.modelEventName();
      line.textContent = name
        ? `正在请${name}询问模型，返回前这一步会停一下。`
        : '正在按本地规则派单。';
      return;
    }
    line.textContent = decision?.explanation || '关键事件出现后，派单、绕行和故障改派会写在这里。平时机器人赶路不会再做一次决策。';
  };

  const updateMeta = () => {
    const map0 = store.world?.map;
    if (!map0) return;
    const cols = [...new Set((map0.obstacles || []).map((point) => point.x))].sort((a, b) => a - b);
    let racks = 0;
    for (let i = 0; i < cols.length; i += 1) if (i === 0 || cols[i] !== cols[i - 1] + 1) racks += 1;
    $('#mapMeta').innerHTML = `${map0.width}×${map0.height} · ${racks} 组货架 · <span class="map-ops">左键旋转 · 右键平移 · 滚轮缩放</span>`;
  };

  const drawStats = () => {
    const summary = store.summary();
    $('#dashStats').innerHTML = statCards([
      { label: '机器人总数', value: summary.robots, hint: '当前世界' },
      { label: '运行中', value: summary.running, hint: '取货或送货途中', tone: 'brand' },
      { label: '订单总数', value: summary.orders, hint: '含已完成' },
      { label: '已完成', value: summary.completed, hint: '累计完成', tone: 'ok' },
      { label: '待分配', value: summary.pending, hint: '尚未派给机器人', tone: summary.pending ? 'warn' : '' },
      { label: '异常', value: summary.faulted, hint: '故障机器人', tone: summary.faulted ? 'bad' : '' },
    ]);
  };

  const togglesEl = $('#mapToggles');
  const renderToggles = () => {
    togglesEl.innerHTML = TOGGLES.map((item) =>
      `<button class="map-toggle ${store.toggles[item.key] ? 'on' : ''}" data-toggle="${item.key}">${item.label}</button>`).join('');
  };
  renderToggles();
  togglesEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-toggle]');
    if (!button) return;
    store.setToggle(button.dataset.toggle, !store.toggles[button.dataset.toggle]);
    button.classList.toggle('on', store.toggles[button.dataset.toggle]);
  });

  $('#mZoomIn').addEventListener('click', () => map.zoom(1.2));
  $('#mZoomOut').addEventListener('click', () => map.zoom(0.83));
  $('#mReset').addEventListener('click', () => { map.setView('default'); setPresetActive('default'); });
  $('#mFit').addEventListener('click', () => map.resetView());
  $('#mFull').addEventListener('click', () => map.fullscreen());
  presetsEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    map.setView(button.dataset.view);
    setPresetActive(button.dataset.view);
    store.setProjection(button.dataset.view === 'default' ? 'iso' : button.dataset.view);
  });

  const cleanups = [
    renderKpi($('#kpiBox')),
    renderSimControl($('#simBox')),
  ];

  const tabs = [
    { key: 'scene', label: '场景事件' },
    { key: 'robot', label: '机器人状态' },
    { key: 'order', label: '订单动态' },
    { key: 'event', label: '事件日志' },
    { key: 'agent', label: 'Agent 决策摘要' },
    { key: 'perf', label: '性能趋势' },
  ];
  let tabCleanup = null;
  const bottomBody = $('#bottomBody');
  const renderTab = (key) => {
    if (tabCleanup) { try { tabCleanup(); } catch { /* 页面切换时忽略 */ } tabCleanup = null; }
    bottomBody.innerHTML = '';
    if (key === 'scene') tabCleanup = renderEventPanel(bottomBody);
    else if (key === 'robot') tabCleanup = renderRobotTable(bottomBody);
    else if (key === 'order') tabCleanup = renderOrderTable(bottomBody);
    else if (key === 'event') tabCleanup = renderEventLog(bottomBody);
    else if (key === 'agent') tabCleanup = renderAgentDecision(bottomBody);
    else if (key === 'perf') tabCleanup = renderPerf(bottomBody);
  };
  tabBar($('#bottomTabs'), tabs, 'scene', renderTab);
  renderTab('scene');

  const applyFocus = () => {
    const request = store.focusRequest;
    if (!request || !store.world) return;
    if (request.kind === 'robot') {
      const robot = store.world.robots?.[request.robotId];
      if (robot) map.focusWorld(robot.position.x, robot.position.y);
    } else if (request.kind === 'order') {
      const order = store.world.orders?.[request.orderId];
      if (order) map.focusWorld(order.pickup.x, order.pickup.y);
    }
    store.focusRequest = null;
  };

  const initialView = store.projection === 'top' ? 'top' : store.projection === 'side' ? 'side' : 'default';
  map.setView(initialView);
  setPresetActive(initialView);

  const drawSegmentBanner = () => {
    const banner = $('#segmentBanner');
    const text = $('#segmentBannerText');
    if (!banner || !text) return;
    const pick = store.segmentPick;
    banner.hidden = !pick;
    if (!pick) return;
    text.textContent = pick.start
      ? `起点 (${pick.start.x}, ${pick.start.y})，再点击同一条通道上的终点`
      : '点击路段起点，终点要和它在同一条横向或纵向通道上';
  };
  $('#segmentCancel').addEventListener('click', () => store.cancelSegmentPick());

  const draftForm = $('#orderDraft');
  const pointValue = (point, axis) => (point ? String(point[axis]) : '');
  const syncDraft = () => {
    const draft = store.orderDraft;
    draftForm.hidden = !draft;
    if (!draft) return;
    const hint = $('#orderDraftHint');
    if (!draft.pickup) hint.textContent = '在地图上点击取货点，或填写下面的坐标。';
    else if (!draft.dropoff) hint.textContent = `取货点 (${draft.pickup.x}, ${draft.pickup.y}) 已选定，再点击送货点。`;
    else hint.textContent = draft.aim === 'pickup'
      ? '下一次地图点击会改取货点。'
      : '下一次地图点击会改送货点。点「取货」或「送货」可以切换。';
    const fresh = draftForm.dataset.seq !== String(draft.seq || 0);
    if (fresh) draftForm.dataset.seq = String(draft.seq || 0);
    const count = $('#orderDraftCount');
    if (fresh || document.activeElement !== count) count.value = draft.count;
    const fields = [
      ['orderPickX', draft.pickup, 'x'],
      ['orderPickY', draft.pickup, 'y'],
      ['orderDropX', draft.dropoff, 'x'],
      ['orderDropY', draft.dropoff, 'y'],
    ];
    fields.forEach(([id, point, axis]) => {
      const input = document.getElementById(id);
      if (!input || document.activeElement === input) return;
      if (!fresh && !point && input.value !== '') return;
      input.value = pointValue(point, axis);
    });
    draftForm.querySelectorAll('[data-aim]').forEach((label) => {
      label.classList.toggle('on', label.dataset.aim === draft.aim);
    });
  };
  const applyTypedPoint = (which) => {
    const xId = which === 'pickup' ? 'orderPickX' : 'orderDropX';
    const yId = which === 'pickup' ? 'orderPickY' : 'orderDropY';
    const xRaw = document.getElementById(xId).value;
    const yRaw = document.getElementById(yId).value;
    if (xRaw === '' || yRaw === '') return;
    store.setOrderDraftPoint(which, Number(xRaw), Number(yRaw));
  };
  $('#orderDraftCount').addEventListener('input', () => {
    if (store.orderDraft) store.orderDraft.count = $('#orderDraftCount').value;
  });
  draftForm.querySelectorAll('[data-aim]').forEach((label) => {
    label.addEventListener('click', () => store.aimOrderDraft(label.dataset.aim));
  });
  ['orderPickX', 'orderPickY'].forEach((id) => {
    document.getElementById(id).addEventListener('focus', () => store.aimOrderDraft('pickup'));
    document.getElementById(id).addEventListener('change', () => applyTypedPoint('pickup'));
  });
  ['orderDropX', 'orderDropY'].forEach((id) => {
    document.getElementById(id).addEventListener('focus', () => store.aimOrderDraft('dropoff'));
    document.getElementById(id).addEventListener('change', () => applyTypedPoint('dropoff'));
  });
  draftForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (store.orderDraft) store.orderDraft.count = $('#orderDraftCount').value;
    applyTypedPoint('pickup');
    applyTypedPoint('dropoff');
    store.createDraftOrders().catch((error) => store.notify('error', error));
  });
  $('#orderDraftCancel').addEventListener('click', () => store.cancelOrderDraft());
  syncDraft();

  const onEscape = (event) => {
    if (event.key !== 'Escape') return;
    if (store.orderDraft) store.cancelOrderDraft();
    else if (store.segmentPick) store.cancelSegmentPick();
  };
  document.addEventListener('keydown', onEscape);

  const unsub = store.subscribe((tag) => {
    if (tag === 'world' || tag === 'state' || tag === 'agent') {
      updateMeta();
      drawStats();
      drawDecision();
      applyFocus();
    }
    if (tag === 'focus') applyFocus();
    if (tag === 'pick') {
      drawSegmentBanner();
      syncDraft();
    }
    if (tag === 'projection') {
      const preset = store.projection === 'top' ? 'top' : store.projection === 'side' ? 'side' : 'default';
      map.setView(preset);
      setPresetActive(preset);
    }
    if (tag === 'toggle') renderToggles();
  });
  updateMeta();
  drawStats();
  drawDecision();
  applyFocus();

  return () => {
    container.classList.remove('page-lock');
    map.destroy();
    unsub();
    document.removeEventListener('keydown', onEscape);
    store.cancelSegmentPick();
    store.cancelOrderDraft();
    cleanups.forEach((fn) => { try { fn(); } catch { /* 忽略 */ } });
    if (tabCleanup) { try { tabCleanup(); } catch { /* 忽略 */ } }
  };
}

function renderPerf(container) {
  const draw = () => {
    const series = store.metricsSeries;
    const enough = (series.throughput || []).length >= 2;
    container.innerHTML = enough ? `
      <div class="analytics-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));padding:12px;gap:10px">
        ${perfBox('吞吐量', '单 / 100 tick', 'throughput')}
        ${perfBox('平均完成时间', 'tick', 'avgTime')}
        ${perfBox('机器人利用率', '%', 'utilization')}
        ${perfBox('拥堵区域数', '块', 'congestion')}
        ${perfBox('故障机器人数', '台', 'fault')}
      </div>` : `<div class="empty"><strong>趋势尚未形成</strong><p>至少运行两步仿真后，这里显示本次运行的真实采样。</p></div>`;
    if (!enough) return;
    requestAnimationFrame(() => {
      container.querySelectorAll('canvas[data-line]').forEach((canvas) => {
        const key = canvas.dataset.line;
        const options = key === 'utilization' ? { min: 0, max: 100 } : { min: 0 };
        lineChart(canvas, [{ data: series[key] || [], color: '#0D9488' }], options);
      });
    });
  };
  const unsub = store.subscribe((tag) => { if (tag === 'world' || tag === 'state') draw(); });
  draw();
  return unsub;
}

function perfBox(label, unit, key) {
  return `<div class="card"><div class="card-head"><h3>${label}</h3><span class="sub">${unit}</span></div>
    <div class="chart-box" style="height:120px"><canvas data-line="${key}"></canvas></div></div>`;
}
