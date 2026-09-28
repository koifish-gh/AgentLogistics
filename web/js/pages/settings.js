// 页面：系统设置 —— 仿真参数 + 显示偏好 + 后端信息

import { store } from '../store.js';
import { $ } from '../util.js';

export function mount(container) {
  container.innerHTML = `
    <div class="analytics-grid">
      <div class="card">
        <div class="card-head"><h3>仿真参数</h3></div>
        <div class="card-body ctl">
          <div class="ctl-row"><label>随机种子</label><input id="setSeed" type="number" value="${store.seed}" style="flex:1" /></div>
          <div class="ctl-row"><label>策略</label>
            <select id="setStrategy" style="flex:1">
              <option value="nearest">nearest 最近优先</option>
              <option value="balanced">balanced 工作量均衡</option>
              <option value="manual">manual Agent 接管</option>
            </select></div>
          <div class="ctl-row"><label>订单生成</label>
            <span class="seg" id="setOrderMode">
              <button data-mode="auto" class="${store.autoOrders ? 'active' : ''}">自动</button>
              <button data-mode="manual" class="${store.autoOrders ? '' : 'active'}">手动</button>
            </span></div>
          <div class="ctl-row"><button class="btn primary" id="setApply" style="flex:1">应用并重置</button></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>显示偏好</h3></div>
        <div class="card-body ctl">
          <div class="ctl-row"><label>默认视角</label>
            <span class="seg" id="setProj">
              <button data-p="iso" class="${store.projection === 'iso' ? 'active' : ''}">3D 等距</button>
              <button data-p="top" class="${store.projection === 'top' ? 'active' : ''}">2D 俯视</button>
            </span></div>
          ${['paths:路径', 'orders:订单', 'heat:热力', 'congestion:拥堵', 'fault:故障', 'grid:坐标']
            .map((kv) => {
              const [key, label] = kv.split(':');
              return `<div class="ctl-row"><label>${label}</label>
                <input type="checkbox" id="setToggle_${key}" ${store.toggles[key] ? 'checked' : ''} /> 显示</div>`;
            }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>后端信息</h3></div>
        <div class="card-body inspector"><div class="kv">
          <b>后端</b><span>${store.backend === 'agent' ? 'Agent 大脑 :8788' : '仿真核心 :8787'}</span>
          <b>连接状态</b><span id="setConn">${store.mockMode ? 'Mock 演示' : store.connected ? '已连接' : '未连接'}</span>
          <b>当前 tick</b><span id="setTick">${store.world?.tick ?? 0}</span>
          <b>数据源</b><span>${store.mockMode ? 'Mock Adapter（后端未连接）' : 'Rust 仿真核心'}</span>
        </div></div>
      </div>
    </div>`;

  $('#setStrategy').value = store.world?.strategy || store.strategy;

  $('#setApply').addEventListener('click', () => {
    store.seed = Number($('#setSeed').value) || 42;
    store.strategy = $('#setStrategy').value;
    store.reset(store.seed).catch((e) => store.notify('error', e));
  });
  $('#setOrderMode').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    store.set({ autoOrders: btn.dataset.mode === 'auto' });
    container.querySelectorAll('#setOrderMode button').forEach((b) => b.classList.toggle('active', b === btn));
  });
  $('#setProj').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    store.setProjection(btn.dataset.p);
    container.querySelectorAll('#setProj button').forEach((b) => b.classList.toggle('active', b === btn));
  });
  for (const key of ['paths', 'orders', 'heat', 'congestion', 'fault', 'grid']) {
    $(`#setToggle_${key}`).addEventListener('change', (e) => store.setToggle(key, e.target.checked));
  }

  const unsub = store.subscribe((tag) => {
    if (tag === 'world' || tag === 'state') {
      $('#setConn').textContent = store.mockMode ? 'Mock 演示' : store.connected ? '已连接' : '未连接';
      $('#setTick').textContent = store.world?.tick ?? 0;
      $('#setStrategy').value = store.world?.strategy || store.strategy;
    }
  });
  return unsub;
}
