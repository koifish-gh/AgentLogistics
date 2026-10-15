// Pure alert lifecycle; independent of DOM, network and model availability.
export const DEFAULT_WAIT_THRESHOLD = 25;
export class AlertEngine {
  constructor(saved = {}) {
    this.threshold = Number.isInteger(saved.threshold) && saved.rulesVersion === 2 && saved.threshold >= 3 && saved.threshold <= 1000 ? saved.threshold : DEFAULT_WAIT_THRESHOLD;
    this.criticalFaultCount = saved.rulesVersion === 2 && Number.isInteger(saved.criticalFaultCount) && saved.criticalFaultCount >= 1 && saved.criticalFaultCount <= 64 ? saved.criticalFaultCount : 2;
    this.criticalWait = saved.rulesVersion === 2 && Number.isInteger(saved.criticalWait) && saved.criticalWait > this.threshold && saved.criticalWait <= 10000 ? saved.criticalWait : Math.max(60, this.threshold + 1);
    this.records = Array.isArray(saved.records) ? saved.records.filter(r => r && typeof r.id === 'string' && ['fault', 'congestion'].includes(r.type)).slice(-200) : [];
    this.generation = Number.isInteger(saved.generation) ? saved.generation : 0;
    this.lastTick = Number.isFinite(saved.lastTick) ? saved.lastTick : null;
    this.lastSeq = Number.isFinite(saved.lastSeq) ? saved.lastSeq : 0;
  }
  export() { return { rulesVersion: 2, threshold: this.threshold, criticalFaultCount: this.criticalFaultCount, criticalWait: this.criticalWait, records: this.records, generation: this.generation, lastTick: this.lastTick, lastSeq: this.lastSeq }; }
  critical() {
    const active = this.records.filter(r => !r.resolved && r.generation === this.generation);
    const faults = active.filter(r => r.type === 'fault');
    const reasons = [];
    if (faults.length >= this.criticalFaultCount) reasons.push({ key: 'fault-count', text: `同时 ${faults.length} 台机器人故障，达到 ${this.criticalFaultCount} 台阈值`, ids: faults.map(r => r.id) });
    for (const r of active) if (r.type === 'congestion' && r.waits >= this.criticalWait) reasons.push({ key: `long-wait-${r.id}`, text: `R${r.robotId} 连续等待 ${r.waits} tick，达到 ${this.criticalWait} tick 阈值`, ids: [r.id] });
    return { active: reasons.length > 0, reasons, signature: reasons.map(r => r.key + ':' + r.ids.join(',')).sort().join('|') };
  }
  reset(tick = 0) {
    for (const record of this.records) if (!record.resolved) { record.resolved = true; record.endTick = tick; record.resolution = '世界已重置，原告警结束'; }
    this.generation += 1; this.lastTick = null; this.lastSeq = 0;
  }
  acknowledge(id) {
    const record = this.records.find(r => r.id === id);
    if (!record || record.resolved || record.acknowledged) return false;
    record.acknowledged = true; record.acknowledgedAt = new Date().toISOString(); return true;
  }
  reconcile(world) {
    if (!world?.robots) return [];
    const seq = world.events?.at(-1)?.sequence || 0;
    if (this.lastTick !== null && (world.tick < this.lastTick || seq < this.lastSeq)) this.reset(world.tick);
    const fresh = [];
    const seen = new Set();
    for (const robot of Object.values(world.robots)) {
      let type;
      if (robot.state === 'faulted') type = 'fault';
      else if (robot.order_id && ['to_pickup', 'to_dropoff'].includes(robot.state) && robot.consecutive_waits >= this.threshold) type = 'congestion';
      if (!type) continue;
      const event = type === 'fault' ? [...(world.events || [])].reverse().find(e => e.kind === 'robot_faulted' && e.robot_id === robot.id) : null;
      const startTick = type === 'fault' ? event?.tick ?? world.tick : Math.max(0, world.tick - robot.consecutive_waits + 1);
      // Preserve an ongoing fault even when event history has been truncated.
      let record = this.records.find(r => !r.resolved && r.generation === this.generation && r.type === type && r.robotId === robot.id
        && (type === 'fault' ? !event || r.sequence === event.sequence : r.startTick === startTick));
      if (!record) {
        const id = `${this.generation}-${type}-${robot.id}-${type === 'fault' ? event?.sequence ?? world.tick : startTick}-${this.records.length}`;
        record = { id, generation: this.generation, type, robotId: robot.id, startTick, detectedTick: world.tick,
          sequence: event?.sequence ?? null, orderId: event?.order_id ?? robot.order_id ?? null,
          acknowledged: false, resolved: false, createdAt: new Date().toISOString() };
        this.records.push(record); fresh.push(record);
      }
      Object.assign(record, { position: { ...robot.position }, lastTick: world.tick, waits: robot.consecutive_waits || 0 });
      seen.add(record.id);
    }
    for (const record of this.records) {
      if (!record.resolved && !seen.has(record.id)) {
        record.resolved = true; record.endTick = world.tick;
        record.resolution = record.type === 'fault' ? '当前已非故障状态或故障已被新事件替代' : '当前不再满足持续等待条件';
      }
    }
    const open = this.records.filter(r => !r.resolved);
    const closed = this.records.filter(r => r.resolved).slice(-Math.max(0, 200 - open.length));
    this.records = [...closed, ...open].sort((a,b) => a.createdAt.localeCompare(b.createdAt));
    this.lastTick = world.tick; this.lastSeq = seq;
    return fresh;
  }
}
