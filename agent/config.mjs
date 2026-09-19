import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const AGENT_DIR = here;
export const ROOT_DIR = resolve(here, '..');
export const BINARY_PATH =
  process.env.LOGISTICS_BIN ||
  resolve(
    ROOT_DIR,
    'target',
    'debug',
    process.platform === 'win32' ? 'logistics.exe' : 'logistics',
  );

function asBool(value, fallback) {
  if (value === undefined) return fallback;
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function asInt(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

export const CONFIG = {
  mode: process.env.AGENT_MODE || (process.env.OPENAI_API_KEY ? 'llm' : 'rule'),
  apiKey: process.env.OPENAI_API_KEY || '',
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  temperature: Number(process.env.OPENAI_TEMPERATURE ?? 0.2),
  maxToolCalls: asInt(process.env.AGENT_MAX_TOOL_CALLS, 12),
  ticksPerTurn: asInt(process.env.AGENT_TICKS_PER_TURN, 1),
  maxTurns: asInt(process.env.AGENT_MAX_TURNS, 300),
  explain: asBool(process.env.AGENT_EXPLAIN, false),
  port: asInt(process.env.AGENT_PORT, 8788),
  eventLimit: asInt(process.env.AGENT_EVENT_LIMIT, 60),
};
