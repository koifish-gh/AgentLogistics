// Layout 组件：Sidebar 导航 + Header（状态/控制）+ Toast

import { NAV_ITEMS, PAGE_META, SPEED_STEPS, STRATEGIES } from '../constants.js';
import { store } from '../store.js';
import { icon, values, $ } from '../util.js';

export function renderNav(container) {
  container.innerHTML = NAV_ITEMS.map(
    (item) => `
    <a class="nav-item" data-route="${item.route}" href="#${item.route}">
      <span class="nav-ico">${icon(item.key)}</span>
      <span class="nav-label">${item.label}<small>${item.sub}</small></span>
    </a>`,
  ).join('');
}

export function setActiveNav(path) {
  const key = (NAV_ITEMS.find((i) => i.route === path) || NAV_ITEMS[0]).key;
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === path);
  });
  const meta = PAGE_META[key];
  $('#pageTitle').textContent = meta.title;
  $('#pageSub').textContent = meta.sub;
}

export function renderHeader(statsEl, controlsEl) {
  controlsEl.innerHTML = `
    <div class="stat num"><span>Tick</span><b id="hTick">0</b></div>
    <div class="speed-seg" id="speedSeg">
      ${SPEED_STEPS.map((s) => `<button data-speed="${s.value}">${s.label}</button>`).join('')}
    </div>
    <button class="icon-btn" id="hPlay" title="运行 / 暂停">${icon('play')}</button>
    <button class="icon-btn" id="hStep" title="前进一步">${icon('step')}</button>
    <button class="icon-btn" id="hReset" title="重置世界">${icon('reset')}</button>
    <button class="icon-btn" id="hSettings" title="系统设置">${icon('settings')}</button>
  `;

  controlsEl.querySelectorAll('#speedSeg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.set({ speed: Number(btn.dataset.speed) });
      update();
    });
  });
  $('#hPlay').addEventListener('click', () => store.togglePlay());
  $('#hStep').addEventListener('click', () => store.stepOnce());
  $('#hReset').addEventListener('click', () => store.reset(store.seed).catch((e) => store.notify('error', e)));
  $('#hSettings').addEventListener('click', () => { location.hash = '/settings'; });

  const update = () => {
    const world = store.world;
    const kpis = store.kpis;
    const robots = values(world?.robots || {});
    const orders = values(world?.orders || {});
    $('#hTick').textContent = world?.tick ?? 0;
    $('#hPlay').innerHTML = icon(store.playing ? 'pause' : 'play');
    controlsEl.querySelectorAll('#speedSeg button').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.speed) === store.speed);
    });

    const status = store.mockMode ? 'warn' : store.connected ? 'ok' : 'bad';
    const statusText = store.mockMode ? 'Mock 演示' : store.connected ? '运行中' : '未连接';
    statsEl.innerHTML = `
      <div class="stat dot ${status}"><i></i><span>${statusText}</span></div>
      <div class="stat num"><span>机器人</span><b>${robots.length}</b></div>
      <div class="stat num"><span>订单</span><b>${orders.length}</b></div>
      <div class="stat num"><span>完成</span><b>${kpis?.completed_orders ?? 0}</b></div>
      <div class="stat num"><span>异常</span><b style="color:${(kpis?.faulted_robots ?? 0) > 0 ? 'var(--danger)' : 'inherit'}">${kpis?.faulted_robots ?? 0}</b></div>
    `;
  };

  store.subscribe((tag) => {
    if (tag === 'world' || tag === 'state' || tag === 'projection' || tag === 'toggle') update();
  });
  update();
}

// 全局 Toast
export function initToast() {
  const el = $('#toast');
  let timer;
  const show = (msg) => {
    el.hidden = false;
    el.textContent = msg;
    clearTimeout(timer);
    timer = setTimeout(() => { el.hidden = true; }, 3000);
  };
  store.subscribe((tag, payload) => {
    if (tag === 'toast') show(payload);
    if (tag === 'error') show(payload?.message || String(payload));
  });
}

export function strategyOptions() {
  return STRATEGIES.map((s) => `<option value="${s.value}">${s.label}</option>`).join('');
}
