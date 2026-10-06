// 页面：系统设置。显示项保存在本机；仿真参数通过现有 reset / set_strategy / generate_orders。

import { store } from '../store.js';
import { endpoints } from '../api.js';
import { $ } from '../util.js';

const TOGGLES = [
  ['paths', '显示路径'],
  ['orders', '显示订单点'],
  ['heat', '显示热力图'],
  ['congestion', '显示拥堵区域'],
  ['fault', '显示故障标记'],
  ['grid', '显示坐标'],
];

export function mount(container) {
  const service = store.backend === 'agent' ? endpoints.agent : endpoints.sim;
  container.innerHTML = `
    <div class="page-stack">
      <p class="settings-motto">感知仓库 · 理解任务 · 智能决策 · 协同执行</p>
      <div class="analytics-grid">
        <div class="card">
          <div class="card-head"><h3>仿真参数</h3><span class="sub">应用时会重置世界</span></div>
          <div class="card-body ctl">
            <div class="ctl-row"><label>随机种子</label><input id="setSeed" type="number" min="0" value="${store.seed}" style="flex:1" /></div>
            <div class="ctl-row"><label>调度策略</label>
              <select id="setStrategy" style="flex:1">
                <option value="nearest">nearest 最近优先</option>
                <option value="balanced">balanced 工作量均衡</option>
                <option value="manual">manual 手动 / Agent</option>
              </select></div>
            <div class="ctl-row"><label>订单生成</label>
              <span class="seg" id="setOrderMode">
                <button data-mode="auto" class="${store.autoOrders ? 'active' : ''}">重置后自动</button>
                <button data-mode="manual" class="${store.autoOrders ? '' : 'active'}">仅手动</button>
              </span></div>
            <div class="ctl-row"><label>生成数量</label><input id="setCount" type="number" min="0" max="1000" value="${store.orderCount}" style="flex:1" /></div>
            <div class="ctl-row"><label>仿真速度</label>
              <span class="seg" id="setSpeed">
                ${[0.5, 1, 2, 4].map((speed) => `<button data-speed="${speed}" class="${store.speed === speed ? 'active' : ''}">${speed}x</button>`).join('')}
              </span></div>
            <p class="note">速度只改变前端推进间隔。自动模式会在重置后调用已有的 generate_orders，不会新增接口。</p>
            <button class="btn primary" id="setApply">应用仿真参数</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>地图显示</h3><span class="sub">立即生效并保存在本机</span></div>
          <div class="card-body ctl">
            <div class="ctl-row"><label>默认视角</label>
              <span class="seg" id="setProj">
                <button data-p="iso" class="${store.projection === 'iso' ? 'active' : ''}">3D 等距</button>
                <button data-p="top" class="${store.projection === 'top' ? 'active' : ''}">俯视</button>
                <button data-p="side" class="${store.projection === 'side' ? 'active' : ''}">侧视</button>
              </span></div>
            ${TOGGLES.map(([key, label]) => `<div class="ctl-row"><label>${label}</label>
              <input type="checkbox" id="setToggle_${key}" ${store.toggles[key] ? 'checked' : ''} /></div>`).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>界面偏好</h3></div>
          <div class="card-body ctl">
            <div class="ctl-row"><label>主题</label>
              <span class="seg" id="setTheme">
                <button data-theme="light" class="${store.theme === 'light' ? 'active' : ''}">浅色</button>
                <button data-theme="dark" class="${store.theme === 'dark' ? 'active' : ''}">深色</button>
              </span></div>
            <div class="ctl-row"><label>卡片密度</label>
              <span class="seg" id="setDensity">
                <button data-density="comfortable" class="${store.density !== 'compact' ? 'active' : ''}">标准</button>
                <button data-density="compact" class="${store.density === 'compact' ? 'active' : ''}">紧凑</button>
              </span></div>
            <button class="btn" id="setResetDisplay">恢复默认显示</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>后端连接</h3></div>
          <div class="card-body inspector"><div class="kv" style="grid-template-columns:96px 1fr">
            <b>服务地址</b><span>${service}</span>
            <b>连接状态</b><span id="setConn">${connectionText()}</span>
            <b>当前 Tick</b><span id="setTick">${store.world?.tick ?? 0}</span>
            <b>数据来源</b><span id="setSource">${sourceText()}</span>
            <b>最近错误</b><span id="setError">${store.lastError || '无'}</span>
          </div></div>
        </div>
      </div>
    </div>`;

  $('#setStrategy').value = store.strategy;

  $('#setApply').addEventListener('click', async () => {
    store.seed = Number($('#setSeed').value);
    store.strategy = $('#setStrategy').value;
    store.orderCount = Number($('#setCount').value);
    const button = $('#setApply');
    button.disabled = true;
    button.textContent = '应用中…';
    try {
      await store.reset(store.seed);
      store.notify('toast', store.autoOrders ? `已重置，并按当前策略准备 ${store.orderCount} 个订单` : '已按新参数重置世界');
    } catch (error) {
      store.notify('error', error);
    } finally {
      button.disabled = false;
      button.textContent = '应用仿真参数';
    }
  });
  $('#setOrderMode').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    store.set({ autoOrders: button.dataset.mode === 'auto' });
    container.querySelectorAll('#setOrderMode button').forEach((item) => item.classList.toggle('active', item === button));
  });
  $('#setSpeed').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    store.set({ speed: Number(button.dataset.speed) });
    container.querySelectorAll('#setSpeed button').forEach((item) => item.classList.toggle('active', item === button));
  });
  $('#setProj').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    store.setProjection(button.dataset.p);
    container.querySelectorAll('#setProj button').forEach((item) => item.classList.toggle('active', item === button));
  });
  $('#setTheme').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    store.set({ theme: button.dataset.theme });
    container.querySelectorAll('#setTheme button').forEach((item) => item.classList.toggle('active', item === button));
  });
  $('#setDensity').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    store.set({ density: button.dataset.density });
    container.querySelectorAll('#setDensity button').forEach((item) => item.classList.toggle('active', item === button));
  });
  $('#setResetDisplay').addEventListener('click', () => {
    store.resetDisplay();
    container.querySelectorAll('#setTheme button').forEach((item) => item.classList.toggle('active', item.dataset.theme === 'light'));
    container.querySelectorAll('#setDensity button').forEach((item) => item.classList.toggle('active', item.dataset.density === 'comfortable'));
    container.querySelectorAll('#setProj button').forEach((item) => item.classList.toggle('active', item.dataset.p === 'iso'));
    for (const [key] of TOGGLES) {
      const input = $(`#setToggle_${key}`);
      if (input) input.checked = !!store.toggles[key];
    }
    store.notify('toast', '显示设置已恢复默认');
  });
  for (const [key] of TOGGLES) {
    $(`#setToggle_${key}`).addEventListener('change', (event) => store.setToggle(key, event.target.checked));
  }

  const unsub = store.subscribe((tag) => {
    if (tag !== 'world' && tag !== 'state' && tag !== 'theme') return;
    const conn = $('#setConn');
    if (!conn) return;
    conn.textContent = connectionText();
    $('#setTick').textContent = store.world?.tick ?? 0;
    $('#setSource').textContent = sourceText();
    $('#setError').textContent = store.lastError || '无';
    const strategy = $('#setStrategy');
    if (strategy) strategy.value = store.strategy;
  });
  return unsub;
}

function connectionText() {
  if (store.mockMode) return '未连接，正在使用演示数据';
  if (store.connected) return store.backend === 'agent' ? 'Agent 服务已连接' : '仿真核心已连接';
  return '未连接';
}

function sourceText() {
  if (store.mockMode) return '前端演示数据';
  return store.backend === 'agent' ? 'Agent 服务转发的仿真快照' : 'Rust 仿真核心';
}
