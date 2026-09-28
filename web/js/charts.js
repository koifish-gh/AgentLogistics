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

const PALETTE = ['#2cc6b0', '#5b9bff', '#f0b34a', '#ff6b7a', '#4fc46f', '#9b7bff'];

export function sparkline(canvas, series, color = '#2cc6b0', { fill = false } = {}) {
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

export function lineChart(canvas, seriesList, { yFormat = (v) => v } = {}) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  const padL = 38;
  const padR = 10;
  const padT = 12;
  const padB = 20;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  if (!seriesList.length || !seriesList[0].data.length) {
    ctx.fillStyle = '#6c7f94';
    ctx.font = '12px sans-serif';
    ctx.fillText('暂无数据', padL, h / 2);
    return;
  }
  const all = seriesList.flatMap((s) => s.data);
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const n = seriesList[0].data.length;

  const xAt = (i) => padL + (n <= 1 ? 0.5 : i / (n - 1)) * plotW;
  const yAt = (v) => padT + (1 - (v - min) / (max - min)) * plotH;

  // 网格 + Y 轴
  ctx.strokeStyle = 'rgba(94,116,138,0.14)';
  ctx.fillStyle = '#6c7f94';
  ctx.font = '10px sans-serif';
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

  ctx.strokeStyle = 'rgba(94,116,138,0.14)';
  ctx.fillStyle = '#6c7f94';
  ctx.font = '10px sans-serif';
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

  ctx.fillStyle = '#9fb0c3';
  ctx.font = '11px sans-serif';
  categories.forEach((cat, ci) => {
    const cx = padL + groupW * ci + groupW / 2;
    ctx.fillText(cat, cx, h - 8);
  });
  ctx.textAlign = 'left';
}

// 仓库热力图：grid 为二维数组
export function heatmap(canvas, grid, { cell } = {}) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!grid || !grid.length) return;
  const rows = grid.length;
  const cols = grid[0].length;
  const cw = cell || Math.floor(w / cols);
  const ch = cw;
  const ox = Math.floor((w - cw * cols) / 2);
  const oy = Math.floor((h - ch * rows) / 2);
  let max = 1;
  for (const row of grid) for (const v of row) max = Math.max(max, v);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const v = grid[y][x] || 0;
      ctx.fillStyle = heatColor(v / max);
      ctx.fillRect(ox + x * cw, oy + y * ch, cw - 0.5, ch - 0.5);
    }
  }
}

// 蓝 → 青 → 黄 → 橙 → 红，低饱和度
function heatColor(t) {
  const stops = [
    [0.0, '#101b2b'],
    [0.35, '#155e6e'],
    [0.6, '#2cc6b0'],
    [0.8, '#f0b34a'],
    [1.0, '#e0523c'],
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const span = b[0] - a[0] || 1;
  const k = (t - a[0]) / span;
  const ac = hexRgb(a[1]);
  const bc = hexRgb(b[1]);
  const r = Math.round(ac.r + (bc.r - ac.r) * k);
  const g = Math.round(ac.g + (bc.g - ac.g) * k);
  const bl = Math.round(ac.b + (bc.b - ac.b) * k);
  return `rgb(${r},${g},${bl})`;
}

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
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
