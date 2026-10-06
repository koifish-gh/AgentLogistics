// 机器人管理页的俯视简图：货架、路径、取送货点和机器人头像。只读当前世界，不改仿真。

import { robotPathColor, robotStatusColor } from './constants.js';
import { values } from './util.js';

export function createRobotSketch(canvas, { store, getLayers, getSelectedId, onSelect }) {
  const ctx = canvas.getContext('2d');
  let hits = [];
  let frame = 0;

  const paint = () => {
    const stage = canvas.parentElement;
    if (!stage) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hits = [];

    const dark = document.documentElement.dataset.theme === 'dark';
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = dark ? '#0b1220' : '#eef5fb';
    ctx.fillRect(0, 0, width, height);

    const map = store.world?.map;
    if (!map?.width || !map?.height) {
      ctx.fillStyle = dark ? '#94a3b8' : '#64748b';
      ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText('等待地图', 16, 28);
      return;
    }

    const layers = getLayers();
    const selectedId = getSelectedId();
    const pad = 18;
    const cell = Math.min((width - pad * 2) / map.width, (height - pad * 2) / map.height);
    const ox = (width - cell * map.width) / 2;
    const oy = (height - cell * map.height) / 2;
    const at = (x, y) => ({ x: ox + (x + 0.5) * cell, y: oy + (y + 0.5) * cell });

    ctx.strokeStyle = dark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.28)';
    ctx.lineWidth = 1;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        ctx.strokeRect(ox + x * cell, oy + y * cell, cell, cell);
      }
    }

    if (layers.shelves) {
      ctx.fillStyle = dark ? '#1d4e89' : '#7eb6ea';
      (map.obstacles || []).forEach((point) => {
        const inset = Math.max(1, cell * 0.12);
        ctx.fillRect(ox + point.x * cell + inset, oy + point.y * cell + inset, cell - inset * 2, cell - inset * 2);
      });
    }

    if (layers.blocked) {
      ctx.fillStyle = dark ? 'rgba(239,68,68,0.45)' : 'rgba(239,68,68,0.28)';
      (map.blocked || []).forEach((point) => {
        ctx.fillRect(ox + point.x * cell, oy + point.y * cell, cell, cell);
      });
    }

    const robots = values(store.world?.robots || {}).sort((a, b) => a.id - b.id);
    if (layers.paths) {
      robots.forEach((robot) => {
        if (!robot.path?.length) return;
        const pos = store.displayPos(robot.id);
        const selected = robot.id === selectedId;
        ctx.beginPath();
        ctx.moveTo(at(pos.x, pos.y).x, at(pos.x, pos.y).y);
        robot.path.forEach((point) => {
          const p = at(point.x, point.y);
          ctx.lineTo(p.x, p.y);
        });
        ctx.strokeStyle = robotPathColor(robot.id);
        ctx.globalAlpha = selected ? 0.95 : 0.35;
        ctx.lineWidth = selected ? 2.5 : 1.5;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      });
    }

    robots.forEach((robot) => {
      const order = robot.order_id ? store.world.orders?.[robot.order_id] : null;
      if (!order) return;
      const selected = robot.id === selectedId;
      if (layers.pickup) pin(at(order.pickup.x, order.pickup.y), '#2563eb', '取', selected);
      if (layers.dropoff) pin(at(order.dropoff.x, order.dropoff.y), '#7c3aed', '送', selected);
    });

    if (layers.robots) {
      const radius = Math.max(8, Math.min(15, cell * 0.46));
      const ordered = robots.filter((robot) => robot.id !== selectedId).concat(robots.filter((robot) => robot.id === selectedId));
      ordered.forEach((robot) => {
        const pos = store.displayPos(robot.id);
        const p = at(pos.x, pos.y);
        face(p.x, p.y, radius, robotPathColor(robot.id), robotStatusColor(robot), `R${robot.id}`, robot.id === selectedId);
        hits.push({ id: robot.id, x: p.x, y: p.y, r: radius + 6 });
      });
    }
  };

  const pin = (point, color, glyph, selected) => {
    const x = point.x;
    const y = point.y;
    ctx.save();
    ctx.globalAlpha = selected ? 1 : 0.72;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - 7, 7, Math.PI, 0);
    ctx.lineTo(x, y + 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 9px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, x, y - 7);
    ctx.restore();
  };

  const face = (x, y, radius, color, ring, label, selected) => {
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.16)';
    ctx.beginPath();
    ctx.ellipse(x, y + radius * 0.85, radius * 0.7, radius * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected ? '#ffffff' : ring;
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.4, radius * 0.12);
    ctx.beginPath();
    ctx.moveTo(x, y - radius * 0.72);
    ctx.lineTo(x, y - radius * 1.05);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y - radius * 1.12, radius * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - radius * 0.28, y - radius * 0.02, radius * 0.16, 0, Math.PI * 2);
    ctx.arc(x + radius * 0.28, y - radius * 0.02, radius * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x - radius * 0.28, y - radius * 0.02, radius * 0.07, 0, Math.PI * 2);
    ctx.arc(x + radius * 0.28, y - radius * 0.02, radius * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y + radius * 0.18, radius * 0.28, 0.25, Math.PI - 0.25);
    ctx.stroke();
    ctx.fillStyle = document.documentElement.dataset.theme === 'dark' ? '#e2e8f0' : '#0f172a';
    ctx.font = `700 ${Math.max(10, radius * 0.72)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x, y + radius + 2);
    ctx.restore();
  };

  const onClick = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = hits.find((item) => (item.x - x) ** 2 + (item.y - y) ** 2 <= item.r ** 2);
    if (!hit) return;
    const robot = store.world?.robots?.[hit.id];
    if (robot) onSelect(robot);
  };

  const loop = () => {
    paint();
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
  canvas.addEventListener('click', onClick);

  return {
    destroy() {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('click', onClick);
    },
  };
}
