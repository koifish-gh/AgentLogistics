// 跨页面共用的展示组件。业务数据由调用方传入，这里不读取接口。

import { escapeHtml } from '../util.js';

export function statCards(items) {
  const cols = Math.min(Math.max(items.length, 1), 6);
  return `<div class="stat-cards cols-${cols}">${items.map((item) => `
    <article class="stat-card ${item.tone ? `tone-${item.tone}` : ''}">
      <div class="label">${escapeHtml(item.label)}</div>
      <div class="value">${escapeHtml(item.value)}</div>
      ${item.hint ? `<div class="hint">${escapeHtml(item.hint)}</div>` : ''}
    </article>`).join('')}</div>`;
}

export function emptyState(title, detail = '') {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}</div>`;
}
