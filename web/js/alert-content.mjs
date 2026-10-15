export function describeAlert(record, world, standards) {
 const robot = world?.robots?.[record.robotId];
 const order = world?.orders?.[record.orderId];
 const point = record.position || robot?.position || { x: '?', y: '?' };
 const title = `${record.type === 'fault' ? '故障停机' : '持续等待预警'} · R${record.robotId}`;
 const facts = [`位置 (${point.x}, ${point.y})`, `发生 tick ${record.startTick}`, `检测 tick ${record.lastTick}`];
 if (record.orderId) facts.push(`关联订单 #${record.orderId}${order ? `（当前 ${order.state}）` : '（当前快照未找到）'}`);
 let cause, condition, suggestion;
 if (record.type === 'fault') {
   cause = '收到仿真故障注入事件；未模拟电机、温度等机械根因。';
   condition = `机器人处于 faulted 状态即触发普通告警；当前已持续 ${Math.max(0,record.lastTick-record.startTick)} tick；故障持续时长本身不触发全局告警。`;
   suggestion = '确认任务接运或改派情况，然后人工修复机器人。';
 } else {
   condition = `连续等待 ${record.waits} tick ≥ 普通阈值 ${standards.threshold} tick；全局等待阈值为 ${standards.criticalWait} tick。`;
   const next = robot?.path?.[0];
   const blocker = next && Object.values(world?.robots || {}).find(r => r.id !== record.robotId && r.position.x === next.x && r.position.y === next.y);
   const blocked = next && [...(world?.map?.blocked || []), ...(world?.map?.obstacles || [])].some(p => p.x === next.x && p.y === next.y);
   cause = blocker ? `下一路径格 (${next.x}, ${next.y}) 当前由 R${blocker.id} 占用，可能影响通行。` : blocked ? `下一路径格 (${next.x}, ${next.y}) 当前不可通行。` : !next ? '当前没有可执行的后续路径，需要检查目标可达性。' : '快照显示持续等待，但单凭该状态不能确认根因，需要结合通道和重规划记录。';
   suggestion = blocker ? `检查 R${blocker.id} 的任务与让行条件，再考虑重新规划。` : '检查封锁与目标可达性，查看 Agent 重规划结果。';
 }
 return { title, facts: facts.join(' · '), cause, condition, suggestion,
   question: `请依据实时记录分析 R${record.robotId} 的${record.type === 'fault' ? '故障' : '持续等待'}：告警发生于 tick ${record.startTick}${record.orderId ? `，关联订单 #${record.orderId}` : ''}。解释当前状态、证据、订单影响和处理建议；历史告警与当前状态不一致时请明确说明。` };
}
