// 页面：总览 Dashboard
// 70/30 布局：左侧 2.5D 仓库地图 + 右侧 KPI/仿真控制/场景事件 + 底部 Tabs 工作区

import { IsoMap } from '../isoMap.js';
import { store } from '../store.js';
import { icon, $ } from '../util.js';
import { lineChart } from '../charts.js';
import {
  renderKpi, renderSimControl, renderEventPanel, renderInspector,
  renderRobotTable, renderOrderTable, renderEventLog, renderAgentDecision, tabBar,
} from '../components/widgets.js';

const TOGGLES = [
  { key: 'paths', label: '路径' },
  { key: 'orders', label: '订单' },
  { key: 'heat', label: '热力' },
  { key: 'congestion', label: '拥堵' },
  { key: 'fault', label: '故障' },
  { key: 'grid', label: '坐标' },
];

export function mount(container) {
  container.innerHTML = `
    <div class="dash" style="display:flex;flex-direction:column;gap:12px">
      <div class="dash-main" style="display:grid;grid-template-columns:minmax(0,1fr) 304px;gap:12px;height:calc(100vh - 110px)">
        <div class="card" style="display:flex;flex-direction:column;min-height:0">
          <div class="card-head">
            <h3>仓库数字孪生</h3>
            <span class="sub" id="mapMeta">12 × 8 · 3 组货架</span>
          </div>
          <div class="map-wrap" id="mapWrap" style="flex:1;min-height:0;border-radius:0 0 12px 12px">
            <canvas id="warehouse"></canvas>
            <div class="map-toggles" id="mapToggles"></div>
            <div class="map-controls">
              <button class="icon-btn" id="mZoomIn" title="放大">${icon('zoomin')}</button>
              <button class="icon-btn" id="mZoomOut" title="缩小">${icon('zoomout')}</button>
              <button class="icon-btn" id="mReset" title="复位视角">${icon('reset')}</button>
              <button class="icon-btn" id="mFull" title="全屏">${icon('fullscreen')}</button>
              <div class="map-presets" id="mapPresets">
                <button class="icon-btn text active" data-view="default" title="默认视角：等距 3D">默</button>
                <button class="icon-btn text" data-view="top" title="俯视：观察仓库布局与机器人路线">俯</button>
                <button class="icon-btn text" data-view="side" title="侧视：观察货架高度与地面机器人">侧</button>
              </div>
            </div>
            <div class="map-legend">
              <span><i class="lg-shelf"></i>货架</span>
              <span><i class="lg-pick"></i>取货区</span>
              <span><i class="lg-drop"></i>送货区</span>
              <span><i class="lg-path"></i>路径</span>
              <span><i class="lg-congestion"></i>拥堵</span>
              <span><i class="lg-fault"></i>故障</span>
            </div>
          </div>
        </div>

        <div class="dash-right" style="display:flex;flex-direction:column;gap:12px;overflow:auto;min-height:0">
          <div id="inspectorSlot"></div>
          <div class="card"><div class="card-head"><h3>核心指标</h3></div><div class="card-body" id="kpiBox"></div></div>
          <div class="card"><div class="card-head"><h3>仿真控制</h3></div><div class="card-body" id="simBox"></div></div>
          <div class="card"><div class="card-head"><h3>场景事件</h3></div><div class="card-body" id="eventBox"></div></div>
        </div>
      </div>

      <div class="card bottom-tabs" style="flex:0 0 auto">
        <div id="bottomTabs"></div>
        <div class="bottom-body" id="bottomBody"></div>
      </div>
    </div>`;

  const map = new IsoMap($('#warehouse'), { store, onSelect: (sel) => store.select(sel) });

  // 地图 meta
  const updateMeta = () => {
    const map0 = store.world?.map;
    if (!map0) return;
    const cols = [...new Set(map0.obstacles.map((p) => p.x))].sort((a, b) => a - b);
    let racks = 0;
    for (let i = 0; i < cols.length; i += 1) if (i === 0 || cols[i] !== cols[i - 1] + 1) racks += 1;
    $('#mapMeta').textContent = `${map0.width} × ${map0.height} · ${racks} 组货架`;
  };

  // toggles
  const togglesEl = $('#mapToggles');
  const renderToggles = () => {
    togglesEl.innerHTML = TOGGLES.map((t) =>
      `<button class="map-toggle ${store.toggles[t.key] ? 'on' : ''}" data-toggle="${t.key}">${t.label}</button>`).join('');
  };
  renderToggles();
  togglesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle]');
    if (!btn) return;
    const key = btn.dataset.toggle;
    store.setToggle(key, !store.toggles[key]);
    btn.classList.toggle('on', store.toggles[key]);
  });

  // 控制按钮（视角预设只动 camera，不触碰仿真状态）
  $('#mZoomIn').addEventListener('click', () => map.zoom(1.2));
  $('#mZoomOut').addEventListener('click', () => map.zoom(0.83));
  $('#mReset').addEventListener('click', () => map.resetView());
  $('#mFull').addEventListener('click', () => map.fullscreen());

  // 视角预设：默认 / 俯视 / 侧视。仅切换前端 camera，不动 store
  const presetsEl = $('#mapPresets');
  const setPresetActive = (preset) => {
    presetsEl.querySelectorAll('[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === preset);
    });
  };
  presetsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    const preset = btn.dataset.view;
    map.setView(preset);
    setPresetActive(preset);
  });

  // 右侧面板
  const cleanups = [
    renderKpi($('#kpiBox')),
    renderSimControl($('#simBox')),
    renderEventPanel($('#eventBox')),
    renderInspector($('#inspectorSlot')),
  ];

  // 底部 Tabs
  const TABS = [
    { key: 'robot', label: '机器人' },
    { key: 'order', label: '订单' },
    { key: 'event', label: '事件日志' },
    { key: 'agent', label: 'Agent 决策' },
    { key: 'perf', label: '性能分析' },
  ];
  let tabCleanup = null;
  const bottomBody = $('#bottomBody');
  const renderTab = (key) => {
    if (tabCleanup) { try { tabCleanup(); } catch (e) {} tabCleanup = null; }
    bottomBody.innerHTML = '';
    if (key === 'robot') tabCleanup = renderRobotTable(bottomBody);
    else if (key === 'order') tabCleanup = renderOrderTable(bottomBody);
    else if (key === 'event') tabCleanup = renderEventLog(bottomBody);
    else if (key === 'agent') tabCleanup = renderAgentDecision(bottomBody);
    else if (key === 'perf') tabCleanup = renderPerf(bottomBody);
  };
  const tabCtl = tabBar($('#bottomTabs'), TABS, 'robot', renderTab);
  renderTab('robot');

  const metaUnsub = store.subscribe(updateMeta);
  // 设置页改 projection 时，把 map 视角同步到对应预设（仍只动 camera，不动仿真）
  const projUnsub = store.subscribe((tag) => {
    if (tag !== 'projection') return;
    const preset = store.projection === 'top' ? 'top' : 'default';
    map.setView(preset);
    setPresetActive(preset);
  });

  updateMeta();

  return () => {
    map.destroy();
    metaUnsub();
    projUnsub();
    cleanups.forEach((fn) => { try { fn(); } catch (e) {} });
    if (tabCleanup) { try { tabCleanup(); } catch (e) {} }
  };
}

// 性能分析（底部 Tab）
function renderPerf(container) {
  const draw = () => {
    const s = store.metricsSeries;
    container.innerHTML = `
      <div class="analytics-grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));padding:12px;gap:10px">
        ${perfBox('吞吐量趋势', 'throughput', '#2cc6b0')}
        ${perfBox('平均完成时间', 'avgTime', '#5b9bff')}
        ${perfBox('机器人利用率', 'utilization', '#f0b34a')}
        ${perfBox('拥堵次数', 'congestion', '#ff9a3c')}
        ${perfBox('故障次数', 'fault', '#ff6b7a')}
      </div>`;
    requestAnimationFrame(() => {
      container.querySelectorAll('canvas[data-line]').forEach((c) => {
        const key = c.dataset.line;
        lineChart(c, [{ data: s[key] || [] }]);
      });
    });
  };
  const unsub = store.subscribe((tag) => { if (tag === 'world' || tag === 'state') draw(); });
  draw();
  return unsub;
}

function perfBox(label, key, color) {
  return `<div class="card"><div class="card-head"><h3>${label}</h3><span class="sub">最近 60 tick</span></div>
    <div class="chart-box" style="height:120px"><canvas data-line="${key}"></canvas></div></div>`;
}
