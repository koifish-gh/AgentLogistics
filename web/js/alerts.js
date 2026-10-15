import { store } from './store.js';
import { AlertEngine } from './alert-engine.mjs';
const KEY = 'al-alerts-v1';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* use defaults */ }
export const alerts = new AlertEngine(saved);
const listeners = new Set();
function publish(fresh = []) {
  try { localStorage.setItem(KEY, JSON.stringify(alerts.export())); } catch { /* storage may be unavailable */ }
  for (const fn of listeners) fn(fresh);
}
export function subscribeAlerts(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function acknowledgeAlert(id) { if (alerts.acknowledge(id)) publish(); }
export function setAlertStandards(values) {
  const threshold = Number(values.threshold);
  const criticalFaultCount = Number(values.criticalFaultCount);
  const criticalWait = Number(values.criticalWait);
  if (!Number.isInteger(threshold) || threshold < 3 || threshold > 1000) throw new Error('预警阈值须为 3–1000 tick');
  if (!Number.isInteger(criticalFaultCount) || criticalFaultCount < 1 || criticalFaultCount > 64) throw new Error('全局故障台数须为 1–64');
  if (!Number.isInteger(criticalWait) || criticalWait <= threshold || criticalWait > 10000) throw new Error('全局等待阈值须大于普通预警阈值，最多10000 tick');
  Object.assign(alerts, { threshold, criticalFaultCount, criticalWait });
  const fresh = !store.mockMode && store.connected ? alerts.reconcile(store.world) : [];
  publish(fresh);
}
export function setWaitThreshold(value) { setAlertStandards({ ...alerts.export(), threshold: value }); }
export function startAlerts() {
  store.subscribe(tag => {
    if (tag === 'world-reset') { alerts.reset(); publish(); return; }
    if ((tag === 'world' || tag === 'state') && !store.mockMode && store.connected && store.world) publish(alerts.reconcile(store.world));
  });
}

export function openAlertCenter(id = null) {
  if (id) sessionStorage.setItem('al-alert-focus', id);
  if (location.hash === '#/alerts') window.dispatchEvent(new Event('alert-focus'));
  else location.hash = '/alerts';
}
export function analyzeAlert(question) {
  sessionStorage.setItem('al-assistant-question', question);
  location.hash = '/assistant';
}
