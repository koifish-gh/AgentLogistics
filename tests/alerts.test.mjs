import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine } from '../web/js/alert-engine.mjs';
const world = (tick=10, state='faulted', waits=0, sequence=1) => ({ tick, robots: {1:{id:1,state,position:{x:1,y:2},order_id:state==='faulted'?null:7,consecutive_waits:waits}}, events:[{kind:'robot_faulted',robot_id:1,order_id:7,tick:1,sequence}] });
test('fault alerts are deduplicated; acknowledgment persists without resolving; repair resolves', () => {
 const e = new AlertEngine({rulesVersion:2,threshold:10}); const [r]=e.reconcile(world()); assert.equal(r.orderId,7);
 assert.equal(e.reconcile(world(11)).length,0); assert.ok(e.acknowledge(r.id));
 const restored = new AlertEngine(JSON.parse(JSON.stringify(e.export())));
 assert.equal(restored.reconcile(world(12)).length,0); assert.equal(restored.records[0].acknowledged,true); assert.equal(restored.records[0].resolved,false);
 restored.reconcile(world(13,'idle')); assert.equal(restored.records[0].resolved,true);
 assert.equal(restored.reconcile(world(14,'faulted',0,2)).length,1);
});
test('wait threshold ignores idle and faulted; ongoing wait not repeated; recovery permits a new episode', () => {
 const e=new AlertEngine({rulesVersion:2,threshold:10}); assert.equal(e.reconcile(world(10,'to_pickup',9)).length,0);
 assert.equal(e.reconcile(world(11,'to_pickup',10)).length,1);
 assert.equal(e.reconcile(world(12,'to_pickup',11)).length,0);
 e.reconcile(world(13,'to_pickup',0)); assert.ok(e.records[0].resolved);
 assert.equal(e.reconcile(world(24,'to_pickup',10)).length,1);
 const idle=new AlertEngine({rulesVersion:2,threshold:10}); assert.equal(idle.reconcile(world(20,'idle',100)).length,0);
 const fault=new AlertEngine({rulesVersion:2,threshold:10}); const [r]=fault.reconcile(world(20,'faulted',100));assert.equal(r.type,'fault');
});
test('world reset archives rather than falsely repairs and new events notify again', () => {
 const e=new AlertEngine({rulesVersion:2,threshold:10}); e.reconcile(world(100));e.reset();assert.match(e.records[0].resolution,/重置/);
 assert.equal(e.reconcile(world()).length,1);
 e.reconcile(world(0,'idle',0,0));assert.ok(e.records.every(r=>r.resolved));
});
test('bad persisted settings use safe default; threshold changes reconcile warnings', () => {
 const e=new AlertEngine({threshold:-1});assert.equal(e.threshold,25);
 e.reconcile(world(30,'to_dropoff',26)); e.threshold=40;e.reconcile(world(30,'to_dropoff',26));assert.ok(e.records[0].resolved);
});

test('a later waiting episode is distinct even if intermediate recovery was not sampled', () => {
 const e=new AlertEngine({rulesVersion:2,threshold:10});e.reconcile(world(100,'to_pickup',50));
 const fresh=e.reconcile(world(120,'to_pickup',10));
 assert.equal(fresh.length,1);assert.equal(e.records.filter(r=>!r.resolved).length,1);
});

test('global standards: single recent fault warns; only simultaneous fault count escalates, not duration', () => {
 const e=new AlertEngine({rulesVersion:2,threshold:10});e.reconcile(world(10));assert.equal(e.critical().active,false);
 e.acknowledge(e.records[0].id);e.reconcile(world(31));assert.equal(e.critical().active,false);
 e.reconcile(world(32,'idle'));assert.equal(e.critical().active,false);
 const many=world(10);many.robots[2]={...many.robots[1],id:2};e.reconcile(many);assert.ok(e.critical().reasons.some(r=>r.key==='fault-count'));
});
test('waiting escalates at critical threshold and clears on recovery; settings persist', () => {
 const e=new AlertEngine({rulesVersion:2,threshold:10});e.reconcile(world(100,'to_pickup',59));assert.equal(e.critical().active,false);
 e.reconcile(world(101,'to_pickup',60));assert.equal(e.critical().active,true);
 const restored=new AlertEngine(e.export());assert.equal(restored.criticalWait,60);assert.equal(restored.critical().active,true);
 restored.reconcile(world(102,'to_pickup',0));assert.equal(restored.critical().active,false);
});

test('popup content changes with robot, order and actual path obstruction', async () => {
 const {describeAlert}=await import('../web/js/alert-content.mjs');
 const e=new AlertEngine({rulesVersion:2,threshold:10});const w=world(20,'to_pickup',12);
 w.robots[1].path=[{x:2,y:2}];w.robots[2]={id:2,position:{x:2,y:2},state:'idle'};
 const [record]=e.reconcile(w);const content=describeAlert(record,w,e);
 assert.match(content.cause,/R2/);assert.match(content.condition,/12 tick/);assert.match(content.condition,/10 tick/);
 assert.match(content.question,/R1/);assert.match(content.question,/#7/);
 w.robots[2].position={x:0,y:0};w.map={blocked:[{x:2,y:2}]};
 assert.match(describeAlert(record,w,e).cause,/不可通行/);
});

test('new defaults migrate old settings to 25 ticks and remove fault-age escalation', () => {
 const e=new AlertEngine({threshold:10,criticalFaultAge:1});assert.equal(e.threshold,25);
 e.reconcile(world(1000));assert.equal(e.critical().active,false);
 const persisted=new AlertEngine(e.export());assert.equal(persisted.threshold,25);
});
