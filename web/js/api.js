// 后端适配层：统一封装「仿真核心 :8787」与「Agent 大脑 :8788」两套接口。
// 未来后端接口完善后，仅需在此层替换实现，UI 无需改动。

const SIM_BASE = location.port === '8788' ? 'http://127.0.0.1:8787' : location.origin;
const AGENT_BASE = location.port === '8788' ? location.origin : 'http://127.0.0.1:8788';

export const backend = location.port === '8788' ? 'agent' : 'sim';
export const endpoints = { sim: SIM_BASE, agent: AGENT_BASE };

function baseUrl() {
  return backend === 'agent' ? AGENT_BASE : SIM_BASE;
}

async function request(path, options = {}) {
  const response = await fetch(baseUrl() + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const message = data.error?.message || data.error || data.message || `HTTP ${response.status}`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  return data;
}

export function command(body) {
  if (backend === 'agent') {
    return request('/api/agent/command', { method: 'POST', body: JSON.stringify(body) });
  }
  return request('/api/command', { method: 'POST', body: JSON.stringify(body) });
}

export function getState() {
  if (backend === 'agent') return request('/api/agent/state');
  return request('/api/state');
}

export function getKpis() {
  if (backend === 'agent') return request('/api/agent/status').then((r) => r.kpis || {});
  return request('/api/kpis');
}

export function getEvents(after = 0) {
  if (backend === 'agent') {
    return request(`/api/agent/events?after=${after}`).then((r) => r.events || []);
  }
  return request(`/api/events?after=${after}`);
}

export function connectStream(onSnapshot) {
  if (backend !== 'sim') return () => {};
  const source = new EventSource(`${SIM_BASE}/api/stream`);
  source.addEventListener('snapshot', (event) => {
    try {
      onSnapshot(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  });
  source.onerror = () => onSnapshot(null);
  return () => source.close();
}

export function agentDecide(ticks = 1, extra = {}) {
  return request('/api/agent/decide', { method: 'POST', body: JSON.stringify({ ticks, ...extra }) });
}

export function agentTrace() {
  return request('/api/agent/trace').then((r) => r.trace || []);
}

export function agentStatus() {
  return request('/api/agent/status').catch(() => ({}));
}

export async function resetWorld({ seed, map, robots }) {
  if (backend === 'agent') {
    const result = await request('/api/agent/reset', {
      method: 'POST',
      body: JSON.stringify({ seed, map, robots }),
    });
    return { world: result.world, kpis: result.kpis };
  }
  await command({ op: 'reset', map, robots, seed });
  return getState();
}
