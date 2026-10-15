import { alerts, subscribeAlerts, openAlertCenter, analyzeAlert } from '../alerts.js';
import { describeAlert } from '../alert-content.mjs';
import { store } from '../store.js';
import { escapeHtml, icon } from '../util.js';
export function initAlertBanner() {
  const button = document.createElement('button');
  button.className = 'btn sm alert-global-button'; button.type = 'button';
  document.querySelector('#headerControls').prepend(button);
  button.addEventListener('click', () => { center.hidden = true; popup.hidden = true; openAlertCenter(); });
  const popup = document.createElement('aside');
  popup.className = 'alert-popup'; popup.hidden = true; popup.setAttribute('role', 'alert');
  document.body.append(popup);
  const glow = document.createElement('div');
  glow.className = 'critical-edge'; glow.hidden = true; glow.setAttribute('aria-hidden', 'true');
  const center = document.createElement('section');
  center.className = 'critical-center'; center.hidden = true; center.setAttribute('role', 'alertdialog');
  center.setAttribute('aria-labelledby', 'criticalTitle');
  const reopen = document.createElement('button'); reopen.type = 'button'; reopen.className = 'critical-reopen'; reopen.hidden = true;
  let dismissedSignature = '';
  try { dismissedSignature = sessionStorage.getItem('al-critical-dismissed') || ''; } catch { /* storage optional */ }
  const saveDismissal = () => { try { sessionStorage.setItem('al-critical-dismissed', dismissedSignature); } catch { /* storage optional */ } };
  const closeWarning = () => {
    dismissedSignature = alerts.critical().signature; saveDismissal();
    center.hidden = true; glow.hidden = true; popup.hidden = true;
    reopen.textContent = '严重告警已收起 · 重新查看';
  };
  reopen.textContent = '严重告警 · 查看原因'; reopen.onclick = () => { dismissedSignature = ''; saveDismissal(); drawCritical(); center.hidden = false; };
  document.body.append(glow, center, reopen);
  center.innerHTML = `<div class="critical-symbol">${icon('alert')}</div><h2 id="criticalTitle">仓库严重告警</h2><p>已达到全局告警标准</p><ul id="criticalReasons"></ul><div id="criticalContext"></div><div class="alert-actions"><button class="btn primary" data-center-open>查看对应告警</button><button class="btn" data-center-analyze>分析此次异常</button><button class="btn" data-center-close>关闭警告</button></div>`;
  let criticalRecord;
  center.querySelector('[data-center-close]').onclick = closeWarning;
  center.querySelector('[data-center-open]').onclick = () => { center.hidden = true; popup.hidden = true; openAlertCenter(criticalRecord?.id); };
  center.querySelector('[data-center-analyze]').onclick = () => { center.hidden = true; popup.hidden = true; if (criticalRecord) analyzeAlert(describeAlert(criticalRecord, store.world, alerts).question); };
  window.addEventListener('hashchange', () => { center.hidden = true; popup.hidden = true; });
  let previousSignature = '';
  const drawCritical = () => {
    const status = alerts.critical();
    const live = store.connected && !store.mockMode;
    const show = live && status.active;
    const dismissed = dismissedSignature === status.signature;
    glow.hidden = !show || dismissed; reopen.hidden = !show;
    reopen.textContent = dismissed ? '严重告警已收起 · 重新查看' : '严重告警 · 查看原因';
    if (!show) { center.hidden = true; previousSignature = ''; return; }
    const wasHidden = center.hidden;
    criticalRecord = alerts.records.find(r => !r.resolved && status.reasons.some(reason => reason.ids.includes(r.id)));
    center.querySelector('#criticalReasons').innerHTML = status.reasons.map(r => `<li>${escapeHtml(r.text)}</li>`).join('');
    const context = criticalRecord && describeAlert(criticalRecord, store.world, alerts);
    center.querySelector('#criticalContext').innerHTML = context ? `<p>${escapeHtml(context.facts)}</p><p>${escapeHtml(context.cause)}</p><p>${escapeHtml(context.suggestion)}</p>` : '';
    center.hidden = dismissed || (status.signature === previousSignature ? wasHidden : false);
    previousSignature = status.signature;

  };
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && alerts.critical().active) closeWarning(); });
  let timer;
  const draw = (fresh = []) => {
    drawCritical();
    const active = alerts.records.filter(r => !r.resolved);
    const unack = active.filter(r => !r.acknowledged).length;
    button.classList.toggle('has-alerts', active.length > 0);
    button.innerHTML = `${icon('alert')} 告警 <b>${active.length}</b>`;
    button.title = `活动告警 ${active.length}，其中 ${unack} 条未确认。打开告警中心；确认不等于修复。`;
    button.setAttribute('aria-label', button.title);
    if (!fresh.length) return;
    const latest = fresh.at(-1);
    const content = describeAlert(latest, store.world, alerts);
    popup.innerHTML = `<div><strong>${escapeHtml(content.title)}${fresh.length > 1 ? ` · 共 ${fresh.length} 条新告警` : ''}</strong><button class="icon-btn" data-dismiss aria-label="关闭提示">×</button></div><p>${escapeHtml(content.facts)}</p><p>${escapeHtml(content.condition)}</p><p>${escapeHtml(content.cause)}</p><p>${escapeHtml(content.suggestion)}</p><div class="alert-actions"><button class="btn sm" data-open>定位此告警</button><button class="btn sm" data-analyze>分析此次异常</button></div>`;
    popup.hidden = false;
    popup.querySelector('[data-dismiss]').onclick = () => { if (alerts.critical().active) closeWarning(); else popup.hidden = true; };
    popup.querySelector('[data-open]').onclick = () => { popup.hidden = true; center.hidden = true; openAlertCenter(latest.id); };
    popup.querySelector('[data-analyze]').onclick = () => { popup.hidden = true; center.hidden = true; analyzeAlert(content.question); };
    clearTimeout(timer); timer = setTimeout(() => { popup.hidden = true; }, 10000);
  };
  subscribeAlerts(draw);
  store.subscribe(tag => { if (tag === 'state' || tag === 'world') drawCritical(); if (tag === 'state' || tag === 'world') button.title = store.mockMode || !store.connected ? '当前后端未连接：显示历史告警，状态待核实' : '打开告警中心'; });
  draw();
}
