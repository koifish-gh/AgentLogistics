// Optional A/C integration bridge: Node.js built-ins only, one persistent Rust world.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'target', 'debug', process.platform === 'win32' ? 'logistics.exe' : 'logistics');
const child = spawn(binary, [], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
const queue = [];
const streams = new Set();
let dead = false;
const fail = error => {
  dead = true;
  for (const job of queue.splice(0)) job.reject(error);
  for (const res of streams) res.end();
  streams.clear();
};
child.on('error', error => { console.error('Build the Rust binary first:', error.message); fail(error); });
child.on('exit', () => fail(new Error('Rust simulation process exited')));
child.stdin.on('error', fail);
createInterface({ input: child.stdout }).on('line', line => {
  const job = queue.shift();
  if (!job) return fail(new Error('Unexpected simulator output'));
  try { job.resolve(JSON.parse(line)); } catch (error) { job.reject(error); }
});
function command(data) {
  if (dead) return Promise.reject(new Error('Simulation unavailable'));
  function checkNumbers(value) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Use safe integers in the JavaScript bridge');
    if (value && typeof value === 'object') for (const child of Object.values(value)) checkNumbers(child);
  }
  checkNumbers(data);
  return new Promise((resolve, reject) => {
    queue.push({ resolve, reject });
    child.stdin.write(JSON.stringify(data) + '\n');
  });
}
// Preserve mutation / subsequent snapshot ordering across concurrent HTTP callers.
let tail = Promise.resolve();
function serialized(action) {
  const result = tail.then(action);
  tail = result.catch(() => {});
  return result;
}
function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function emit(res, snapshot) {
  // Slow clients reconnect for the latest complete snapshot; avoid unbounded buffers.
  if (!res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)) {
    streams.delete(res); res.end();
  }
}
const queries = new Set(['get_state', 'get_kpis', 'get_events', 'plan_path']);
export const server = http.createServer(async (req, res) => {
  try {
    const host = new URL(`http://${req.headers.host || ''}`);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return send(res, 403, { error: 'Local host required' });
    if (req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (!['http:', 'https:'].includes(origin.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) return send(res, 403, { error: 'Local origin required' });
      res.setHeader('Access-Control-Allow-Origin', origin.origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      return await serialized(async () => {
        if (streams.size >= 16) return send(res, 429, { error: 'Too many event streams' });
        const snapshot = await command({ op: 'get_state' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        streams.add(res);
        res.on('close', () => streams.delete(res));
        emit(res, snapshot);
      });
    }
    let data;
    if (req.method === 'GET' && url.pathname === '/api/state') data = { op: 'get_state' };
    else if (req.method === 'GET' && url.pathname === '/api/kpis') data = { op: 'get_kpis' };
    else if (req.method === 'GET' && url.pathname === '/api/events') {
      const after = Number(url.searchParams.get('after') ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) return send(res, 400, { error: 'after must be a nonnegative safe integer' });
      data = { op: 'get_events', after };
    } else if (req.method === 'POST' && url.pathname === '/api/command') {
      if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return send(res, 415, { error: 'Use application/json' });
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) return send(res, 413, { error: 'Request limit is 64 KiB' });
        chunks.push(chunk);
      }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } else return send(res, 404, { error: 'Use /api/state, /api/kpis, /api/events, /api/stream or POST /api/command' });
    await serialized(async () => {
      const result = await command(data);
      send(res, result.ok ? 200 : 400, result);
      if (result.ok && !queries.has(data.op) && streams.size) {
        const snapshot = await command({ op: 'get_state' });
        for (const stream of streams) emit(stream, snapshot);
      }
    });
  } catch (error) {
    if (!res.headersSent) send(res, dead ? 503 : 400, { ok: false, error: error.message });
    else res.end();
  }
});
server.requestTimeout = 30000;
server.on('error', error => { console.error(error.message); child.kill(); process.exitCode = 1; });
server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => console.log(`Simulation API: http://127.0.0.1:${server.address().port}/api/state`));
export function shutdown() {
  for (const res of streams) res.end();
  child.kill();
  return new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
