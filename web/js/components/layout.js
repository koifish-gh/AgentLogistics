// Layout 组件：Sidebar 导航 + Header（状态/控制）+ Toast

import { NAV_ITEMS, PAGE_META, SPEED_STEPS, STRATEGIES } from '../constants.js';
import { store } from '../store.js';
import { icon, $ } from '../util.js';

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
  statsEl.innerHTML = `<div id="headerLive" class="header-live"></div>`;
  const live = $('#headerLive');
  $('#hResetWorld').addEventListener('click', () => store.reset(store.seed).catch((e) => store.notify('error', e)));

  controlsEl.innerHTML = `
    <div class="stat num"><span>Tick</span><b id="hTick">0</b></div>
    <div class="speed-seg" id="speedSeg">
      ${SPEED_STEPS.map((s) => `<button data-speed="${s.value}">${s.label}</button>`).join('')}
    </div>
    <button class="icon-btn" id="hPlay" title="运行 / 暂停">${icon('play')}</button>
    <button class="icon-btn" id="hStep" title="前进一步">${icon('step')}</button>
    <button class="icon-btn" id="hReset" title="重置世界，并清除本机保存">${icon('reset')}</button>
    <button class="icon-btn" id="hTheme" title="切换浅色 / 深色">${icon(store.theme === 'dark' ? 'sun' : 'moon')}</button>
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
  $('#hTheme').addEventListener('click', () => {
    store.set({ theme: store.theme === 'dark' ? 'light' : 'dark' });
  });

  const update = () => {
    const summary = store.summary();
    $('#hTick').textContent = summary.tick;
    $('#hPlay').innerHTML = icon(store.playing ? 'pause' : 'play');
    const themeBtn = $('#hTheme');
    if (themeBtn) themeBtn.innerHTML = icon(store.theme === 'dark' ? 'sun' : 'moon');
    controlsEl.querySelectorAll('#speedSeg button').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.speed) === store.speed);
    });

    const waited = store.deciding ? Math.max(0, Math.round((Date.now() - store.decideStarted) / 1000)) : 0;
    const modelEvent = store.deciding ? store.modelEventName() : '';
    const status = store.mockMode ? 'warn' : store.deciding ? 'warn' : store.connected ? 'ok' : 'bad';
    const statusText = store.mockMode
      ? '演示数据'
      : store.deciding
        ? (modelEvent ? `${modelEvent} 询问模型 ${waited}s` : `决策中 ${waited}s`)
        : store.connected
          ? (store.playing ? '运行中' : '已连接')
          : '未连接';
    live.innerHTML = `
      <div class="stat dot ${status}${store.deciding ? ' deciding' : ''}"><i></i><span>${statusText}</span></div>
      <div class="stat num"><span>机器人</span><b>${summary.robots}</b></div>
      <div class="stat num"><span>订单</span><b>${summary.orders}</b></div>
      <div class="stat num"><span>完成</span><b>${summary.completed}</b></div>
      <div class="stat num"><span>异常</span><b style="color:${summary.faulted > 0 ? 'var(--danger)' : 'inherit'}">${summary.faulted}</b></div>
    `;
  };

  store.subscribe((tag) => {
    if (tag === 'world' || tag === 'state' || tag === 'projection' || tag === 'toggle' || tag === 'theme') update();
  });
  setInterval(() => {
    if (store.deciding) update();
  }, 1000);
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
