// 3D 仓储数字孪生地图渲染器（原生 Canvas，无依赖）
// 支持：自由视角（左键旋转 / 右键平移 / 滚轮缩放 / 双击聚焦）、视角预设、
//       视角限制（pitch 15°~75°、缩放 0.3~4、平移限于仓库范围）、3D 货架、机器人、路径、拥堵、故障、热力、点击选中。
// 视角状态完全独立于仿真逻辑：仅修改 camera，不触碰 store 中的机器人/路径/订单/tick。

import { robotStatusColor } from './constants.js';
import { values, clamp } from './util.js';

const DEG = Math.PI / 180;
const DEFAULT_YAW = 45 * DEG;
const DEFAULT_PITCH = 30 * DEG;
const PITCH_MIN = 15 * DEG;
const PITCH_MAX = 75 * DEG;
const SCALE_MIN = 0.3;
const SCALE_MAX = 4;
const SHELF_H = 0.55;          // 货架世界高度（cell 单位）
const PAN_MARGIN = 80;         // 平移约束留白

// ---------- 颜色工具：派生霓虹色（顶面更亮、侧面更暗） ----------
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return { r: 128, g: 128, b: 128 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
function mixColor(hex, withHex, ratio) {
  const a = hexToRgb(hex);
  const b = hexToRgb(withHex);
  const r = Math.round(a.r + (b.r - a.r) * ratio);
  const g = Math.round(a.g + (b.g - a.g) * ratio);
  const bl = Math.round(a.b + (b.b - a.b) * ratio);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}
const darken = (hex, r) => mixColor(hex, '#000000', r);
const brighten = (hex, r) => mixColor(hex, '#ffffff', r);

export class IsoMap {
  constructor(canvas, { store, onSelect }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;
    this.onSelect = onSelect;

    this.cell = 64;          // 基础 tile 尺寸（投影单位 = cell / √2）
    // camera 完全独立于仿真状态：只在前端被视角控制修改
    this.camera = {
      scale: 1, cx: 0, cy: 0,
      yaw: DEFAULT_YAW,     // 水平旋转（绕 Z 轴）
      pitch: DEFAULT_PITCH,  // 垂直旋转（俯仰角）
    };
    this.hover = null;
    this._drag = null;
    this._raf = 0;
    this._fitted = false;
    this._tileOffs = [];     // 当前 yaw/pitch 下，单位 tile 4 角偏移（屏幕像素）

    this._bindEvents();
    this._loop();
  }

  // ---------- 投影 ----------
  projUnit() { return this.cell / Math.SQRT2; }

  // 3D 投影：返回未应用 scale/pan 的原始坐标 + 深度（深度大 = 远离相机）
  project(x, y, z) {
    const cy = Math.cos(this.camera.yaw);
    const sy = Math.sin(this.camera.yaw);
    const cp = Math.cos(this.camera.pitch);
    const sp = Math.sin(this.camera.pitch);
    const x1 = cy * x - sy * y;
    const y1 = sy * x + cy * y;
    return {
      sx: x1,
      sy: sp * y1 - cp * z,
      depth: cp * y1 + sp * z,
    };
  }

  // 投影 3D 点到屏幕像素（含 depth，供货架绘制使用）
  _projectPx(x, y, z) {
    const p = this.project(x, y, z);
    const u = this.projUnit() * this.camera.scale;
    return {
      x: p.sx * u + this.camera.cx,
      y: p.sy * u + this.camera.cy,
      depth: p.depth,
    };
  }

  worldToScreen(x, y) {
    const p = this.project(x, y, 0);
    const u = this.projUnit() * this.camera.scale;
    return {
      x: p.sx * u + this.camera.cx,
      y: p.sy * u + this.camera.cy,
    };
  }

  screenToWorld(px, py) {
    const u = this.projUnit() * this.camera.scale;
    const sx = (px - this.camera.cx) / u;
    const sy = (py - this.camera.cy) / u;
    const cy = Math.cos(this.camera.yaw);
    const sy_ = Math.sin(this.camera.yaw);
    const sp = Math.sin(this.camera.pitch);
    if (Math.abs(sp) < 1e-3) return { x: 0, y: 0 };   // 退化保护
    // 由 sx = cos(yaw)*x - sin(yaw)*y 与 sy = sin(pitch)*(sin(yaw)*x + cos(yaw)*y) 反解
    const k = sy / sp;
    return {
      x: cy * sx + sy_ * k,
      y: -sy_ * sx + cy * k,
    };
  }

  // ---------- 视图 ----------
  fitToView() {
    const map = this.store.world?.map;
    const rect = this.canvas.getBoundingClientRect();
    if (!map || !rect.width) return;
    const pts = [
      this.project(0, 0, 0),
      this.project(map.width - 1, 0, 0),
      this.project(0, map.height - 1, 0),
      this.project(map.width - 1, map.height - 1, 0),
    ];
    const u = this.projUnit();
    const xs = pts.map((p) => p.sx * u);
    const ys = pts.map((p) => p.sy * u);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX;
    const h = maxY - minY;
    const pad = 40;
    const scale = clamp(Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h), SCALE_MIN, SCALE_MAX);
    this.camera.scale = scale;
    this.camera.cx = rect.width / 2 - ((minX + maxX) / 2) * scale;
    this.camera.cy = rect.height / 2 - ((minY + maxY) / 2) * scale;
    this._fitted = true;
  }

  resetView() {
    this._fitted = false;
    this.fitToView();
  }

  // 视角预设：只动 camera，不动 store
  setView(preset) {
    const presets = {
      default: { yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH },
      top: { yaw: DEFAULT_YAW, pitch: 85 * DEG },     // 接近正上方，仍保留等距朝向，便于观察布局
      side: { yaw: DEFAULT_YAW, pitch: 15 * DEG },   // 低俯角，便于观察货架高度
    };
    const p = presets[preset];
    if (!p) return;
    this.camera.yaw = p.yaw;
    this.camera.pitch = clamp(p.pitch, PITCH_MIN, PITCH_MAX);
    this._fitted = false;
    this.fitToView();
  }

  fullscreen() {
    const wrap = this.canvas.parentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap?.requestFullscreen?.();
  }

  zoom(factor) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    this._zoomAt(cx, cy, factor);
  }

  _zoomAt(px, py, factor) {
    const before = this.screenToWorld(px, py);
    this.camera.scale = clamp(this.camera.scale * factor, SCALE_MIN, SCALE_MAX);
    const after = this.worldToScreen(before.x, before.y);
    this.camera.cx += px - after.x;
    this.camera.cy += py - after.y;
    this._constrainPan();
  }

  // 平移约束：仓库中心必须保留在画布可见区域内
  _constrainPan() {
    const map = this.store.world?.map;
    const rect = this.canvas.getBoundingClientRect();
    if (!map || !rect.width) return;
    const c = this.worldToScreen(map.width / 2, map.height / 2);
    const maxX = Math.max(PAN_MARGIN, rect.width - PAN_MARGIN);
    const maxY = Math.max(PAN_MARGIN, rect.height - PAN_MARGIN);
    if (c.x < PAN_MARGIN) this.camera.cx += PAN_MARGIN - c.x;
    else if (c.x > maxX) this.camera.cx -= c.x - maxX;
    if (c.y < PAN_MARGIN) this.camera.cy += PAN_MARGIN - c.y;
    else if (c.y > maxY) this.camera.cy -= c.y - maxY;
  }

  // 双击聚焦：把目标格居中
  _focusOn(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    const t = this.worldToScreen(x, y);
    this.camera.cx += rect.width / 2 - t.x;
    this.camera.cy += rect.height / 2 - t.y;
    this._constrainPan();
  }

  // ---------- 事件 ----------
  // 左键拖动：水平 + 垂直旋转；右键 / 中键拖动：平移；滚轮：缩放；双击：聚焦选中格
  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      this._zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 0.89);
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      this._drag = {
        x: e.clientX, y: e.clientY,
        button: e.button,     // 0=左键 1=中键 2=右键
        moved: false,
      };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (this._drag) {
        const dx = e.clientX - this._drag.x;
        const dy = e.clientY - this._drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this._drag.moved = true;
        if (this._drag.button === 0) {
          // 左键：自由旋转（yaw 360°，pitch 限 15°~75°，禁止翻转 / 穿地）
          this.camera.yaw -= dx * 0.01;
          this.camera.pitch = clamp(this.camera.pitch - dy * 0.01, PITCH_MIN, PITCH_MAX);
        } else if (this._drag.button === 2 || this._drag.button === 1) {
          // 右键 / 中键：平移（受仓库边界约束）
          this.camera.cx += dx;
          this.camera.cy += dy;
          this._constrainPan();
        }
        this._drag.x = e.clientX;
        this._drag.y = e.clientY;
      }
      this.hover = this._worldCell(px, py);
    });
    c.addEventListener('pointerup', (e) => {
      const wasDrag = this._drag?.moved;
      const button = this._drag?.button;
      this._drag = null;
      if (wasDrag) return;
      if (button !== 0) return;   // 仅左键单击触发选中
      const rect = c.getBoundingClientRect();
      this._pick(e.clientX - rect.left, e.clientY - rect.top);
    });
    c.addEventListener('pointerleave', () => { this.hover = null; });
    c.addEventListener('dblclick', (e) => {
      const rect = c.getBoundingClientRect();
      const cell = this._worldCell(e.clientX - rect.left, e.clientY - rect.top);
      if (cell) this._focusOn(cell.x, cell.y);   // 快速聚焦选中格
      else this.resetView();
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());   // 屏蔽右键菜单，让右键拖动可用
  }

  _worldCell(px, py) {
    const map = this.store.world?.map;
    if (!map) return null;
    const w = this.screenToWorld(px, py);
    const x = Math.round(w.x);
    const y = Math.round(w.y);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    return { x, y };
  }

  _pick(px, py) {
    const data = this.store.data();
    if (!data.world) return;
    const world = data.world;
    // 优先机器人（按屏幕距离）
    let bestRobot = null;
    let bestDist = this.cell * 0.7 * this.camera.scale;
    for (const robot of values(world.robots)) {
      const p = this.worldToScreen(robot.position.x, robot.position.y);
      const d = Math.hypot(px - p.x, py - p.y);
      if (d < bestDist) { bestDist = d; bestRobot = robot; }
    }
    if (bestRobot) {
      this.onSelect({ kind: 'robot', robotId: bestRobot.id, x: bestRobot.position.x, y: bestRobot.position.y });
      return;
    }
    // 其次订单站点
    let bestOrder = null;
    let bestOrderDist = this.cell * 0.6 * this.camera.scale;
    for (const order of values(world.orders)) {
      if (order.state === 'completed') continue;
      for (const pos of [order.pickup, order.dropoff]) {
        const p = this.worldToScreen(pos.x, pos.y);
        const d = Math.hypot(px - p.x, py - p.y);
        if (d < bestOrderDist) { bestOrderDist = d; bestOrder = order; }
      }
    }
    if (bestOrder) {
      this.onSelect({ kind: 'order', orderId: bestOrder.id });
      return;
    }
    // 最后格子
    const cell = this._worldCell(px, py);
    if (cell) this.onSelect({ kind: 'cell', x: cell.x, y: cell.y });
  }

  // ---------- 主循环 ----------
  _loop = () => {
    this._raf = requestAnimationFrame(this._loop);
    this.render();
  };

  destroy() {
    cancelAnimationFrame(this._raf);
  }

  render() {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(rect.width * dpr) || this.canvas.height !== Math.round(rect.height * dpr)) {
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#0d141b';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const world = this.store.world;
    if (!world) {
      ctx.fillStyle = '#6c7f94';
      ctx.font = '13px sans-serif';
      ctx.fillText('正在加载仓库地图…', 20, 30);
      return;
    }
    if (!this._fitted) this.fitToView();

    const now = performance.now();
    const map = world.map;
    const toggles = this.store.toggles;
    const data = this.store.data();
    const shelfSet = new Set((map.obstacles || []).map((p) => `${p.x},${p.y}`));
    const blockedSet = new Set((map.blocked || []).map((p) => `${p.x},${p.y}`));
    const heatMax = this._maxHeat(world);
    const selected = this.store.selected;

    // 预计算单位 tile 的 4 角屏幕偏移（依赖 yaw/pitch/scale，每帧重建一次以支持自由旋转）
    const u = this.projUnit() * this.camera.scale;
    const offsRaw = [
      this.project(-0.5, -0.5, 0),
      this.project(0.5, -0.5, 0),
      this.project(0.5, 0.5, 0),
      this.project(-0.5, 0.5, 0),
    ];
    this._tileOffs = offsRaw.map((p) => ({ x: p.sx * u, y: p.sy * u }));

    // 1) 地面 tile
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        this._drawFloor(x, y, shelfSet, blockedSet, data, toggles, heatMax, world);
      }
    }

    // 2) 拥堵 / 故障覆盖（贴地）
    if (toggles.congestion) for (const zone of data.congestion) this._drawZone(zone, '#ff9a3c');
    if (toggles.fault) this._drawFaults(map, blockedSet, world, selected);

    // 3) 机器人路径（贴地，先于立体物体绘制，避免盖在货架上）
    if (toggles.paths) this._drawPaths(world, selected, now);

    // 4) 订单站点（地面标记）
    if (toggles.orders) this._drawOrders(world, selected);

    // 5) 货架 + 机器人统一按深度排序（正确遮挡：前方货架挡住后方机器人，机器人不「骑」在货架上）
    const drawables = [];
    for (const s of map.obstacles || []) drawables.push({ d: s.x + s.y, kind: 'shelf', x: s.x, y: s.y });
    for (const robot of values(world.robots)) drawables.push({ d: robot.position.x + robot.position.y, kind: 'robot', robot });
    drawables.sort((a, b) => a.d - b.d);
    for (const item of drawables) {
      if (item.kind === 'shelf') this._drawShelf(item.x, item.y);
      else this._drawRobot(item.robot, now, selected);
    }

    // 6) 悬浮高亮
    if (this.hover) this._drawHover(this.hover);
  }

  _maxHeat(world) {
    let max = 1;
    for (const row of world.heatmap || []) for (const v of row) max = Math.max(max, v);
    return max;
  }

  // ---------- 地面 ----------
  _drawFloor(x, y, shelfSet, blockedSet, data, toggles, heatMax, world) {
    const ctx = this.ctx;
    const key = `${x},${y}`;
    const isShelf = shelfSet.has(key);
    const center = this.worldToScreen(x, y);
    const scale = this.camera.scale;

    const inPickup = data.zones.pickup.some((p) => p.x === x && p.y === y);
    const inDropoff = data.zones.dropoff.some((p) => p.x === x && p.y === y);

    // 道路：稍亮的深灰蓝；货架区：更深，形成明确边界
    const road = isShelf ? '#0c1219' : '#17212c';
    const stroke = isShelf ? 'rgba(80,102,122,0.35)' : 'rgba(70,90,110,0.32)';
    this._tilePoly(center.x, center.y, 1.0, road, stroke);
    if (!isShelf && inPickup) this._tilePoly(center.x, center.y, 1.0, 'rgba(79,196,111,0.12)', null);
    if (!isShelf && inDropoff) this._tilePoly(center.x, center.y, 1.0, 'rgba(91,155,255,0.12)', null);

    if (toggles.heat && !isShelf) {
      const heat = world.heatmap?.[y]?.[x] || 0;
      if (heat) {
        this._tilePoly(center.x, center.y, 1.0, `rgba(240,179,74,${0.06 + (heat / heatMax) * 0.4})`, null);
      }
    }

    if (toggles.grid && !isShelf) {
      ctx.fillStyle = 'rgba(140,160,180,0.5)';
      ctx.font = `${Math.max(8, this.cell * 0.2 * scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`${x},${y}`, center.x, center.y + 3);
      ctx.textAlign = 'start';
    }
  }

  // 任意 yaw 下的单位 tile 多边形（4 角来自 _tileOffs）
  _tilePoly(cx, cy, scaleFactor, fill, stroke) {
    const ctx = this.ctx;
    const o = this._tileOffs;
    if (!o || o.length !== 4) return;
    ctx.beginPath();
    ctx.moveTo(cx + o[0].x * scaleFactor, cy + o[0].y * scaleFactor);
    for (let i = 1; i < 4; i += 1) ctx.lineTo(cx + o[i].x * scaleFactor, cy + o[i].y * scaleFactor);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // ---------- 货架（真 3D 立方体投影） ----------
  // 通过 8 个角点投影，按 yaw 自动剔除背面，按深度排序可见侧面
  _drawShelf(x, y) {
    const ctx = this.ctx;
    const scale = this.camera.scale;
    const yaw = this.camera.yaw;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);

    // 立方体盒（中心 (x, y, SHELF_H/2)，半尺寸 (0.5, 0.5, SHELF_H/2)）
    this._drawBox(x, y, SHELF_H * 0.5, 0.5, 0.5, SHELF_H * 0.5, {
      top: '#44586c',
      topStroke: 'rgba(210,224,236,0.2)',
      east: 'rgba(66,86,106,0.64)',
      west: 'rgba(52,71,91,0.60)',
      north: 'rgba(52,71,91,0.60)',
      south: 'rgba(66,86,106,0.64)',
    });

    // 4 根立柱（垂直棱）
    ctx.strokeStyle = 'rgba(15,22,30,0.9)';
    ctx.lineWidth = Math.max(1, this.cell * 0.035 * scale);
    ctx.beginPath();
    for (const [px, py] of [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]]) {
      const b = this._projectPx(px, py, 0);
      const t = this._projectPx(px, py, SHELF_H);
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(t.x, t.y);
    }
    ctx.stroke();

    // 横梁（2 层货位，只绘制当前 yaw 下可见的侧棱）
    ctx.strokeStyle = 'rgba(210,224,236,0.24)';
    ctx.lineWidth = 1;
    for (const level of [0.5, 0.82]) {
      const z = SHELF_H * level;
      const e = [
        this._projectPx(x - 0.5, y - 0.5, z),  // 0: SW
        this._projectPx(x + 0.5, y - 0.5, z),  // 1: SE
        this._projectPx(x + 0.5, y + 0.5, z),  // 2: NE
        this._projectPx(x - 0.5, y + 0.5, z),  // 3: NW
      ];
      ctx.beginPath();
      if (cosY < 0) { ctx.moveTo(e[0].x, e[0].y); ctx.lineTo(e[1].x, e[1].y); }  // south
      if (sinY > 0) { ctx.moveTo(e[1].x, e[1].y); ctx.lineTo(e[2].x, e[2].y); }  // east
      if (cosY > 0) { ctx.moveTo(e[2].x, e[2].y); ctx.lineTo(e[3].x, e[3].y); }  // north
      if (sinY < 0) { ctx.moveTo(e[3].x, e[3].y); ctx.lineTo(e[0].x, e[0].y); }  // west
      ctx.stroke();
    }

    // 货箱（2 个小立方体，置于横梁层）
    this._drawCrate(x - 0.22, y - 0.05, SHELF_H * 0.5, 0.18, 0.18, 0.1, '#d7d9da');
    this._drawCrate(x + 0.22, y + 0.05, SHELF_H * 0.82, 0.18, 0.18, 0.1, '#e6d9bd');
  }

  // 通用 3D 立方体绘制：8 角投影 + 背面剔除 + 深度排序
  _drawBox(cx, cy, cz, sx, sy, sz, colors) {
    const c = [
      this._projectPx(cx - sx, cy - sy, cz - sz),  // 0: bot SW
      this._projectPx(cx + sx, cy - sy, cz - sz),  // 1: bot SE
      this._projectPx(cx + sx, cy + sy, cz - sz),  // 2: bot NE
      this._projectPx(cx - sx, cy + sy, cz - sz),  // 3: bot NW
      this._projectPx(cx - sx, cy - sy, cz + sz),  // 4: top SW
      this._projectPx(cx + sx, cy - sy, cz + sz),  // 5: top SE
      this._projectPx(cx + sx, cy + sy, cz + sz),  // 6: top NE
      this._projectPx(cx - sx, cy + sy, cz + sz),  // 7: top NW
    ];
    const yaw = this.camera.yaw;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const ctx = this.ctx;

    const face = (idxList, color, stroke) => {
      if (!color && !stroke) return;
      ctx.beginPath();
      ctx.moveTo(c[idxList[0]].x, c[idxList[0]].y);
      for (let i = 1; i < idxList.length; i += 1) ctx.lineTo(c[idxList[i]].x, c[idxList[i]].y);
      ctx.closePath();
      if (color) { ctx.fillStyle = color; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    };

    // 可见侧面（按深度排序，远的先画），yaw 决定哪两个面朝向相机
    const sides = [];
    if (sinY > 0 && colors.east) sides.push({ idx: [1, 2, 6, 5], color: colors.east, depth: c[1].depth });
    if (sinY < 0 && colors.west) sides.push({ idx: [3, 0, 4, 7], color: colors.west, depth: c[3].depth });
    if (cosY > 0 && colors.north) sides.push({ idx: [2, 3, 7, 6], color: colors.north, depth: c[2].depth });
    if (cosY < 0 && colors.south) sides.push({ idx: [0, 1, 5, 4], color: colors.south, depth: c[0].depth });
    sides.sort((a, b) => b.depth - a.depth);
    for (const s of sides) face(s.idx, s.color, null);

    // 顶面（pitch > 0 时永远可见）
    if (colors.top) face([4, 5, 6, 7], colors.top, colors.topStroke || null);
  }

  _drawCrate(cx, cy, baseZ, sx, sy, sz, color) {
    // baseZ 是货箱底部 z，绘制时中心在 baseZ + sz/2
    this._drawBox(cx, cy, baseZ + sz * 0.5, sx, sy, sz * 0.5, {
      top: color,
      topStroke: 'rgba(0,0,0,0.28)',
      east: 'rgba(0,0,0,0.18)',
      west: 'rgba(0,0,0,0.22)',
      north: 'rgba(0,0,0,0.22)',
      south: 'rgba(0,0,0,0.18)',
    });
  }

  // ---------- 拥堵 / 故障 ----------
  _drawZone(zone, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.16;
    for (const cell of zone.cells) {
      const c = this.worldToScreen(cell.x, cell.y);
      this._tilePoly(c.x, c.y, 1.0, color, null);
    }
    ctx.restore();
  }

  _drawFaults(map, blockedSet, world, selected) {
    const ctx = this.ctx;
    // 封锁格
    for (const p of map.blocked || []) {
      const c = this.worldToScreen(p.x, p.y);
      this._tilePoly(c.x, c.y, 1.0, 'rgba(255,107,122,0.16)', 'rgba(255,107,122,0.7)');
    }
    // 故障机器人（红色脉冲环，克制）
    for (const robot of values(world.robots)) {
      if (robot.state !== 'faulted') continue;
      const c = this.worldToScreen(robot.position.x, robot.position.y);
      const r = this.cell * 0.5 * this.camera.scale * (1 + 0.06 * Math.sin(performance.now() / 300));
      ctx.strokeStyle = 'rgba(255,107,122,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---------- 订单站点 ----------
  _drawOrders(world, selected) {
    for (const order of values(world.orders)) {
      if (order.state === 'completed') continue;
      const active = order.state === 'assigned' || order.state === 'in_transit';
      this._drawStation(order.pickup, '#4fc46f', active ? `取 ${order.id}` : '', active, selected?.kind === 'order' && selected.orderId === order.id);
      this._drawStation(order.dropoff, '#5b9bff', active ? `送 ${order.id}` : '', active, false);
      if (order.recovery_from) this._drawStation(order.recovery_from, '#f0b34a', '接运', true, false);
    }
  }

  _drawStation(pos, color, label, active, isSelected) {
    const ctx = this.ctx;
    const c = this.worldToScreen(pos.x, pos.y);
    const scale = this.camera.scale;
    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.6;
    this._tilePoly(c.x, c.y, 0.85, color + (active ? '33' : '22'), isSelected ? '#ffffff' : color);
    if (label) {
      ctx.fillStyle = color;
      ctx.font = `600 ${Math.max(9, this.cell * 0.2 * scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, c.x, c.y + 3);
      ctx.textAlign = 'start';
    }
    ctx.restore();
  }

  // ---------- 路径 ----------
  _drawPaths(world, selected, now) {
    for (const robot of values(world.robots)) {
      const path = robot.path || [];
      if (!path.length || robot.state === 'faulted') continue;
      const pos = this.store.displayPos(robot.id);
      const isSelected = selected?.kind === 'robot' && selected.robotId === robot.id;
      const color = isSelected ? '#f0b34a' : robotStatusColor(robot);
      const points = [pos, ...path].map((step) => {
        const c = this.worldToScreen(step.x, step.y);
        return { x: c.x, y: c.y };
      });
      const ctx = this.ctx;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // 细虚线，贴地行驶（不加粗底衬，避免悬浮感）
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = Math.max(1.5, this.cell * 0.055 * this.camera.scale);
      ctx.setLineDash([Math.max(3, this.cell * 0.16 * this.camera.scale), Math.max(3, this.cell * 0.2 * this.camera.scale)]);
      ctx.lineDashOffset = -now / 80;
      this._trace(points);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // 终点箭头
      const last = points[points.length - 1];
      const prev = points[points.length - 2] || points[0];
      this._arrow(prev, last, color);
    }
  }

  _trace(points) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  _arrow(from, to, color) {
    const ctx = this.ctx;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    const angle = Math.atan2(dy, dx);
    const size = Math.max(4, this.cell * 0.15 * this.camera.scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - size * Math.cos(angle - 0.5), to.y - size * Math.sin(angle - 0.5));
    ctx.lineTo(to.x - size * Math.cos(angle + 0.5), to.y - size * Math.sin(angle + 0.5));
    ctx.closePath();
    ctx.fill();
  }

  // ---------- 机器人 ----------
  // 计算世界空间归一化方向（用于 3D chevron 旋转）；静止时沿用前次方向
  _robotHeadingVec(robot, pos) {
    const path = robot.path || [];
    let dx = 0;
    let dy = 0;
    if (path.length) {
      dx = path[0].x - pos.x;
      dy = path[0].y - pos.y;
    } else {
      const m = this.store.motion.get(robot.id);
      if (m) {
        dx = m.to.x - pos.x;
        dy = m.to.y - pos.y;
        if (Math.abs(dx) < 0.03 && Math.abs(dy) < 0.03) {
          dx = m.to.x - m.from.x;
          dy = m.to.y - m.from.y;
        }
      }
    }
    const len = Math.hypot(dx, dy);
    if (len < 0.04) {
      // 静止：复用前次方向；默认指东
      const prev = this.store.headings.get(robot.id);
      if (Array.isArray(prev) && prev.length === 2) return { dx: prev[0], dy: prev[1] };
      return { dx: 1, dy: 0 };
    }
    const dxN = dx / len;
    const dyN = dy / len;
    this.store.headings.set(robot.id, [dxN, dyN]);
    return { dx: dxN, dy: dyN };
  }

  // 3D 彩色 AGV：低多边形立方体车体 + 顶部发光面板 + 3D 方向 chevron
  // 视角状态完全独立：仅读取机器人世界坐标，不修改任何仿真状态
  _drawRobot(robot, now, selected) {
    const ctx = this.ctx;
    const pos = this.store.displayPos(robot.id);
    const scale = this.camera.scale;
    const status = robotStatusColor(robot);   // 状态基色（青/琥珀/红/灰）
    const isSelected = selected?.kind === 'robot' && selected.robotId === robot.id;
    const { dx, dy } = this._robotHeadingVec(robot, pos);

    // 颜色派生：顶面更亮（霓虹感），侧面更暗（体积感）
    const top = brighten(status, 0.38);
    const side = darken(status, 0.42);
    const sideDark = darken(status, 0.56);
    const panelTop = brighten(status, 0.62);

    // 1. 选中地面环（选中机器人高亮）
    if (isSelected) {
      const c = this.worldToScreen(pos.x, pos.y);
      ctx.strokeStyle = 'rgba(240,179,74,0.7)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, this.cell * 0.46 * scale, this.cell * 0.22 * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 2. 主车体：3D 立方体（半宽 0.24 cell，半高 0.10 cell，中心在 z=0.10）
    const BODY_S = 0.24;   // sx = sy（接近正方形，方向由 chevron 表示）
    const BODY_H = 0.10;   // sz
    this._drawBox(pos.x, pos.y, BODY_H, BODY_S, BODY_S, BODY_H, {
      top,
      topStroke: status,
      east: side,
      west: sideDark,
      north: side,
      south: sideDark,
    });

    // 3. 顶部发光面板（略小、更亮，营造 LED 顶面）
    const PANEL_Z = BODY_H * 2 + 0.014;       // 紧贴车体顶部
    const PANEL_S = BODY_S * 0.78;
    this._drawBox(pos.x, pos.y, PANEL_Z, PANEL_S, PANEL_S, 0.014, {
      top: panelTop,
      topStroke: brighten(status, 0.78),
      east: brighten(status, 0.18),
      west: brighten(status, 0.06),
      north: brighten(status, 0.18),
      south: brighten(status, 0.06),
    });

    // 4. 方向 chevron：3D 世界空间三角形，朝 heading 方向投影后绘制
    //    前点位于车头外缘，两点位于车尾两侧
    const CHEV_Z = PANEL_Z + 0.014;
    const fwd = BODY_S + 0.04;        // 前点到中心距离
    const back = BODY_S - 0.04;       // 后点到中心距离
    const halfW = BODY_S * 0.62;      // 后点横向半宽
    // 世界空间旋转：把 (1,0) 映射为，(0,1) 映射为 (-dy, dx)
    const p1 = this._projectPx(pos.x + dx * fwd, pos.y + dy * fwd, CHEV_Z);
    const p2 = this._projectPx(pos.x - dx * back - dy * halfW, pos.y - dy * back + dx * halfW, CHEV_Z);
    const p3 = this._projectPx(pos.x - dx * back + dy * halfW, pos.y - dy * back - dx * halfW, CHEV_Z);
    ctx.fillStyle = brighten(status, 0.78);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 5. 载货：送货途中顶部小货箱（暖色调，表示已取货）
    if (robot.state === 'to_dropoff') {
      const CRATE_Z = CHEV_Z + 0.04;
      this._drawBox(pos.x - dx * 0.06, pos.y - dy * 0.06, CRATE_Z + 0.05, 0.11, 0.11, 0.05, {
        top: '#e5d3a6',
        topStroke: '#c9b480',
        east: '#c9b480',
        west: '#a89060',
        north: '#c9b480',
        south: '#a89060',
      });
    }

    // 6. 标签悬浮于机器人正上方（不参与旋转）
    const labelP = this._projectPx(pos.x, pos.y, PANEL_Z + 0.06);
    ctx.fillStyle = '#eef5ff';
    ctx.font = `700 ${Math.max(8, this.cell * 0.17 * scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 3;
    ctx.fillText(`R${robot.id}`, labelP.x, labelP.y);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'start';
  }

  _rrect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  // ---------- 悬浮 ----------
  _drawHover(cell) {
    const c = this.worldToScreen(cell.x, cell.y);
    this._tilePoly(c.x, c.y, 1.0, 'rgba(44,198,176,0.1)', 'rgba(44,198,176,0.5)');
  }
}
