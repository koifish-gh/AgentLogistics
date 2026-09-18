import assert from 'node:assert/strict';
import { once } from 'node:events';
process.env.PORT = '0';
const { server, shutdown } = await import('../scripts/server.mjs');
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
async function call(data) {
  const response = await fetch(base + '/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return { status: response.status, data: await response.json() };
}
let reader;
try {
  let res = await fetch(base + '/api/state');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).tick, 0);
  const stream = await fetch(base + '/api/stream');
  reader = stream.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: snapshot/);
  const added = await call({ op: 'add_order', pickup: { x: 1, y: 0 }, dropoff: { x: 11, y: 0 } });
  assert.equal(added.status, 200);
  assert.equal(added.data.data.order_id, 1);
  const updated = await reader.read();
  assert.match(new TextDecoder().decode(updated.value), /order_created/);
  await reader.cancel(); reader = null;
  const concurrent = await Promise.all([call({ op: 'step', ticks: 1 }), call({ op: 'step', ticks: 1 })]);
  assert.deepEqual(concurrent.map(r => r.data.tick).sort(), [1, 2]);
  const completed = await call({ op: 'step', ticks: 30 });
  assert.equal(completed.data.data.completed_orders, 1);
  assert.equal((await call({ op: 'step', ticks: 0 })).status, 400);
  res = await fetch(base + '/api/events?after=0');
  assert((await res.json()).data.some(e => e.kind === 'order_completed'));
  res = await fetch(base + '/api/events?after=-1'); assert.equal(res.status, 400);
  res = await fetch(base + '/api/state', { headers: { Origin: 'https://example.com' } }); assert.equal(res.status, 403);
  res = await fetch(base + '/api/state', { headers: { Origin: 'http://localhost:5173' } }); assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  res = await fetch(base + '/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }); assert.equal(res.status, 400);
  console.log('HTTP/SSE smoke: PASS (state, commands, events, push, concurrency, errors, CORS)');
} finally {
  if (reader) await reader.cancel();
  await shutdown();
}
