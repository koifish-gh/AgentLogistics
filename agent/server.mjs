#!/usr/bin/env node
import http from 'node:http';

import { CONFIG } from './config.mjs';
import { AgentBrain } from './loop.mjs';
import { SIM_TOOLS } from './tools.mjs';

function send(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

function isLocalHostname(hostname) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
}

async function readJson(req, limit = 65536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function withCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      if (isLocalHostname(url.hostname)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
    } catch {
      // Ignore malformed origins.
    }
  }
}

function safeInt(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function safePositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

const brain = new AgentBrain({ mode: CONFIG.mode });
let ready = null;

function ensureReady() {
  if (!ready) {
    ready = brain
      .start()
      .then(() => brain.reset())
      .catch((error) => {
        ready = null;
        throw error;
      });
  }
  return ready;
}

let tail = Promise.resolve();
function serialized(action) {
  const result = tail.then(action, action);
  tail = result.catch(() => {});
  return result;
}

const server = http.createServer(async (req, res) => {
  withCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    const host = new URL(`http://${req.headers.host || 'localhost'}`);
    if (!isLocalHostname(host.hostname)) {
      return send(res, 403, { error: 'Local host required' });
    }
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/api/agent/tools') {
      return send(res, 200, { tools: SIM_TOOLS });
    }

    if (req.method === 'GET' && url.pathname === '/api/agent/status') {
      try {
        await ensureReady();
        const state = await brain.client.call('get_state');
        return send(res, 200, {
          mode: brain.mode,
          tick: state.world.tick,
          kpis: state.kpis,
          event_after: brain.eventAfter,
          trace_length: brain.trace.length,
        });
      } catch (error) {
        return send(res, 503, { error: error.message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/agent/state') {
      await ensureReady();
      const state = await brain.client.call('get_state');
      return send(res, 200, state);
    }

    if (req.method === 'GET' && url.pathname === '/api/agent/events') {
      const after = safeInt(url.searchParams.get('after'), 0);
      await ensureReady();
      const events = await brain.client.call('get_events', { after });
      return send(res, 200, { events, after });
    }

    if (req.method === 'GET' && url.pathname === '/api/agent/trace') {
      return send(res, 200, { trace: brain.trace });
    }

    if (req.method === 'POST' && url.pathname === '/api/agent/reset') {
      const body = await readJson(req);
      const result = await serialized(() =>
        ensureReady().then(() => brain.reset(body)),
      );
      return send(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/agent/decide') {
      const body = await readJson(req);
      const result = await serialized(() =>
        ensureReady().then(() =>
          brain.runTurn({
            ticks: safePositiveInt(body.ticks, brain.ticksPerTurn),
          }),
        ),
      );
      return send(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/agent/run') {
      const body = await readJson(req);
      const result = await serialized(() =>
        ensureReady().then(() =>
          brain.run({
            turns: safePositiveInt(body.turns, 1),
            ticks: safePositiveInt(body.ticks, brain.ticksPerTurn),
          }),
        ),
      );
      return send(res, 200, {
        runs: result.length,
        last: result.at(-1) || null,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/agent/command') {
      const body = await readJson(req);
      const { op, args, ...rest } = body;
      const result = await serialized(() =>
        ensureReady().then(() => brain.client.call(op, args || rest)),
      );
      return send(res, 200, result);
    }

    return send(res, 404, { error: 'Unknown agent endpoint' });
  } catch (error) {
    if (!res.headersSent) send(res, 400, { error: error.message });
    else res.end();
  }
});

server.requestTimeout = 30000;
server.listen(CONFIG.port, '127.0.0.1', () => {
  console.log(`Agent brain API: http://127.0.0.1:${CONFIG.port}`);
  console.log(`Mode: ${CONFIG.mode}`);
});

async function shutdown() {
  await brain.close();
  server.closeAllConnections?.();
  server.close();
}

process.on('SIGINT', () => {
  shutdown().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  shutdown().finally(() => process.exit(0));
});
