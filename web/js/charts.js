// 轻量 Canvas 图表（无依赖）：sparkline / 折线 / 分组柱状 / 热力图

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const PALETTE = ['#0D9488', '#3B82F6', '#F59E0B', '#EF4444', '#16A34A', '#7C3AED'];

function axisColor() {
  return document.documentElement.dataset.theme === 'dark' ? '#94a3b8' : '#64748b';
}
function gridColor() {
  return document.documentElement.dataset.theme === 'dark' ? 'rgba(148,163,184,0.16)' : 'rgba(100,116,139,0.16)';
}
function formatTick(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 100) return String(Math.round(n));
  if (abs >= 10) return String(Math.round(n * 10) / 10);
  return String(Math.round(n * 100) / 100);
}

export function sparkline(canvas, series, color = '#0D9488', { fill = false } = {}) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!series || series.length < 2) return;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pad = 2;
  ctx.beginPath();
  series.forEach((v, i) => {
    const x = pad + (i / (series.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (fill) {
    ctx.lineTo(w - pad, h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = color + '22';
    ctx.fill();
    ctx.beginPath();
    series.forEach((v, i) => {
      const x = pad + (i / (series.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function lineChart(canvas, seriesList, { yFormat = formatTick, min: fixedMin, max: fixedMax } = {}) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  const padL = 42;
  const padR = 10;
  const padT = 12;
  const padB = 20;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const longest = Math.max(0, ...seriesList.map((series) => series.data?.length || 0));
  if (!seriesList.length || longest < 2) {
    ctx.fillStyle = axisColor();
    ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText('数据点不足，继续运行后显示趋势', 16, h / 2);
    return;
  }
  const all = seriesList.flatMap((s) => s.data);
  let min = fixedMin ?? Math.min(...all);
  let max = fixedMax ?? Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const n = longest;

  const xAt = (i) => padL + (n <= 1 ? 0.5 : i / (n - 1)) * plotW;
  const yAt = (v) => padT + (1 - (v - min) / (max - min)) * plotH;

  ctx.strokeStyle = gridColor();
  ctx.fillStyle = axisColor();
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const v = min + ((max - min) * i) / 4;
    const y = yAt(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(yFormat(v), padL - 5, y + 3);
  }
  ctx.textAlign = 'left';

  seriesList.forEach((series, si) => {
    const color = series.color || PALETTE[si % PALETTE.length];
    ctx.beginPath();
    series.data.forEach((v, i) => {
      const x = xAt(i);
      const y = yAt(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    // 末点
    const lx = xAt(series.data.length - 1);
    const ly = yAt(series.data[series.data.length - 1]);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(lx, ly, 2.5, 0, Math.PI * 2); ctx.fill();
  });
}

export function barChart(canvas, categories, seriesList, { yFormat = (v) => v } = {}) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  const padL = 38, padR = 10, padT = 12, padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  if (!categories.length) return;
  const all = seriesList.flatMap((s) => s.data);
  const max = Math.max(1, ...all);

  ctx.strokeStyle = gridColor();
  ctx.fillStyle = axisColor();
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i += 1) {
    const v = (max * i) / 4;
    const y = padT + (1 - i / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(yFormat(v), padL - 5, y + 3);
  }
  ctx.textAlign = 'center';

  const groupW = plotW / categories.length;
  const barW = Math.min(24, (groupW * 0.7) / seriesList.length);
  seriesList.forEach((series, si) => {
    const color = series.color || PALETTE[si % PALETTE.length];
    categories.forEach((cat, ci) => {
      const v = series.data[ci] || 0;
      const cx = padL + groupW * ci + groupW / 2;
      const offset = (si - (seriesList.length - 1) / 2) * (barW + 3);
      const x = cx + offset - barW / 2;
      const y = padT + (1 - v / max) * plotH;
      const bh = (v / max) * plotH;
      ctx.fillStyle = color;
      roundRect(ctx, x, y, barW, bh, 2);
      ctx.fill();
    });
  });

  ctx.fillStyle = axisColor();
  ctx.font = '11px sans-serif';
  categories.forEach((cat, ci) => {
    const cx = padL + groupW * ci + groupW / 2;
    ctx.fillText(cat, cx, h - 8);
  });
  ctx.textAlign = 'left';
}

// 仓库热力图：grid 为二维数组
export function heatmap(canvas, grid, { cell, obstacles = [], blocked = [] } = {}) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!grid || !grid.length) {
    ctx.fillStyle = axisColor();
    ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText('暂无仓库地图', 16, h / 2);
    return;
  }
  const rows = grid.length;
  const cols = grid[0].length;
  const cw = cell || Math.max(4, Math.floor(Math.min(w / cols, h / rows)));
  const ch = cw;
  const ox = Math.floor((w - cw * cols) / 2);
  const oy = Math.floor((h - ch * rows) / 2);
  const shelf = new Set(obstacles.map((point) => `${point.x},${point.y}`));
  const closed = new Set(blocked.map((point) => `${point.x},${point.y}`));
  let max = 1;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!shelf.has(`${x},${y}`)) max = Math.max(max, grid[y][x] || 0);
    }
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const key = `${x},${y}`;
      if (shelf.has(key)) ctx.fillStyle = '#d5dee8';
      else ctx.fillStyle = heatColor((grid[y][x] || 0) / max);
      ctx.fillRect(ox + x * cw, oy + y * ch, cw - 0.4, ch - 0.4);
      if (closed.has(key)) {
        ctx.strokeStyle = '#b91c1c';
        ctx.lineWidth = 1;
        ctx.strokeRect(ox + x * cw + 0.5, oy + y * ch + 0.5, cw - 1.4, ch - 1.4);
      }
    }
  }
}

// 主色由浅到深。t 为 0..1，按当前图里最高停留次数归一化。
function heatColor(t) {
  const k = Math.max(0, Math.min(1, t));
  const light = hexRgb('#e7f6f3');
  const dark = hexRgb('#0f766e');
  const r = Math.round(light.r + (dark.r - light.r) * k);
  const g = Math.round(light.g + (dark.g - light.g) * k);
  const b = Math.round(light.b + (dark.b - light.b) * k);
  return `rgb(${r},${g},${b})`;
}

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function donutChart(canvas, slices, { legend = true, center } = {}) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  const data = (slices || []).filter((slice) => slice.value > 0);
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  if (!total) {
    ctx.fillStyle = axisColor();
    ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText('暂无订单', 16, h / 2);
    return;
  }
  const cx = legend ? w * 0.34 : w / 2;
  const cy = h / 2;
  const radius = Math.min(legend ? w * 0.28 : w * 0.36, h * 0.38);
  let angle = -Math.PI / 2;
  data.forEach((slice) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    angle += sweep;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.58, 0, Math.PI * 2);
  ctx.fillStyle = document.documentElement.dataset.theme === 'dark' ? '#111827' : '#ffffff';
  ctx.fill();
  if (center) {
    ctx.textAlign = 'center';
    ctx.fillStyle = document.documentElement.dataset.theme === 'dark' ? '#e5e7eb' : '#0f172a';
    ctx.font = '700 20px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(String(center.value), cx, cy - 2);
    ctx.fillStyle = axisColor();
    ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(center.label, cx, cy + 16);
  }
  if (!legend) return;
  ctx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  data.forEach((slice, index) => {
    const y = 28 + index * 22;
    ctx.fillStyle = slice.color;
    ctx.fillRect(w * 0.62, y - 9, 10, 10);
    ctx.fillStyle = axisColor();
    ctx.fillText(`${slice.label}  ${slice.value}`, w * 0.62 + 16, y);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
