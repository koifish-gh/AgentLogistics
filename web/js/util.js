// 通用工具：DOM、格式化、图标

export const $ = (sel, root = document) => root.querySelector(sel);

export function values(obj) {
  return obj ? Object.values(obj) : [];
}

export function posKey(p) {
  return `${p.x},${p.y}`;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function formatNum(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '0';
  return Number(value).toFixed(digits).replace(/\.?0+$/, '');
}

export function percent(value) {
  return `${formatNum((value || 0) * 100, 1)}%`;
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// 简单 SVG 图标（stroke 风格，currentColor）
const ICONS = {
  dashboard: '<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z"/>',
  robot: '<rect x="4" y="7" width="16" height="11" rx="2"/><circle cx="12" cy="12" r="2.2"/><path d="M8 7V5M16 7V5"/><path d="M12 18v2M6 18h2M16 18h2"/>',
  orders: '<path d="M6 3h12v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2L6 21zM9 8h6M9 12h6"/>',
  analytics: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  play: '<path d="M7 4l12 8-12 8z"/>',
  pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z"/>',
  step: '<path d="M6 4l8 8-8 8zM16 4h2v16h-2z"/>',
  reset: '<path d="M4 4v6h6M5.5 15a8 8 0 1 0 .5-8.4L4 10"/>',
  zoomin: '<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4-4M11 8v6M8 11h6"/>',
  zoomout: '<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4-4M8 11h6"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  grid: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>',
  heat: '<path d="M12 3c1 3 4 4.5 4 8a4 4 0 1 1-8 0c0-1 .3-2 .8-2.8C9.5 9 10.5 10 12 12c1-2 1-4 0-9z"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h7"/>',
  alert: '<path d="M12 3l10 18H2zM12 10v4M12 17.5v.5"/>',
  filter: '<path d="M4 4h16l-6 7v6l-4 2v-8z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10v4"/><rect x="5" y="9" width="10" height="6" rx="1"/>',
};

export function icon(name, size = 16) {
  const body = ICONS[name] || ICONS.dashboard;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// 防抖
export function debounce(fn, ms = 120) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
