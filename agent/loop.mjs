import { CONFIG } from './config.mjs';
import { LLMClient } from './llm.mjs';
import { RulePolicy } from './policy.mjs';
import { SimulationClient } from './sim-client.mjs';
import { SIM_TOOLS, executeTool } from './tools.mjs';
import {
  buildSystemPrompt,
  buildUserMessage,
  collectObservation,
} from './observation.mjs';

const DEFAULT_MAP = {
  width: 12,
  height: 8,
  obstacles: [3, 6, 9].flatMap((x) =>
    [2, 3, 4, 5].map((y) => ({ x, y })),
  ),
  blocked: [],
};

const DEFAULT_ROBOTS = [
  { x: 0, y: 0 },
  { x: 0, y: 3 },
  { x: 0, y: 7 },
];

export class AgentBrain {
  constructor(options = {}) {
    this.client = options.client || new SimulationClient(options.sim || {});
    this.mode = options.mode || CONFIG.mode;
    this.ticksPerTurn = options.ticksPerTurn ?? CONFIG.ticksPerTurn;
    this.maxToolCalls = options.maxToolCalls ?? CONFIG.maxToolCalls;
    this.maxTurns = options.maxTurns ?? CONFIG.maxTurns;
    this.explain = options.explain ?? CONFIG.explain;
    this.eventAfter = 0;
    this.trace = [];
    this.llm =
      options.llm ||
      (this.mode === 'llm'
        ? new LLMClient(options.llmOptions || {})
        : null);
    this.policy = new RulePolicy();
  }

  async start() {
    await this.client.start();
    await this.client.call('set_strategy', { strategy: 'manual' });
  }

  async observe() {
    const observation = await collectObservation(
      this.client,
      this.eventAfter,
      CONFIG.eventLimit,
    );
    this.eventAfter = observation.after;
    return observation;
  }

  async reset(options = {}) {
    if (!this.client.started) await this.start();
    await this.client.call('reset', {
      map: options.map || DEFAULT_MAP,
      robots: options.robots || DEFAULT_ROBOTS,
      seed: options.seed ?? 42,
    });
    await this.client.call('set_strategy', { strategy: 'manual' });
    this.eventAfter = 0;
    this.trace = [];
    return this.observe();
  }

  async runTurn(options = {}) {
    if (!this.client.started) await this.start();
    const before = await this.observe();
    const turnTrace =
      this.mode === 'llm'
        ? await this.runLlmTurn(before, options)
        : await this.policy.decide(this.client, before.world);

    const after = await this.observe();
    const turn = {
      tick: after.world.tick,
      mode: this.mode,
      actions: turnTrace,
      kpis: after.kpis,
    };

    if (this.mode === 'llm' && this.explain) {
      turn.explanation = await this.explainTurn(turn);
    }

    this.trace.push(turn);
    if (this.trace.length > 200) this.trace.shift();
    return {
      world: after.world,
      kpis: after.kpis,
      events: after.events,
      turn,
    };
  }

  async runLlmTurn(before, options = {}) {
    const turnTrace = [];
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserMessage(before) },
    ];
    let stepCalled = false;

    for (let i = 0; i < this.maxToolCalls; i += 1) {
      let message;
      try {
        message = await this.llm.chat({
          messages,
          tools: SIM_TOOLS,
          toolChoice: 'auto',
        });
      } catch (error) {
        turnTrace.push({ role: 'error', error: error.message });
        break;
      }

      const toolCalls = message.tool_calls || [];
      messages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      });

      if (toolCalls.length === 0) {
        if (message.content) {
          turnTrace.push({ role: 'assistant', content: message.content });
        }
        break;
      }

      for (const call of toolCalls) {
        let args = {};
        try {
          args = call.function.arguments
            ? JSON.parse(call.function.arguments)
            : {};
        } catch {
          args = { _parse_error: call.function.arguments };
        }

        const result = await executeTool(this.client, call.function.name, args);
        if (call.function.name === 'step') stepCalled = true;
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
        turnTrace.push({
          role: 'tool',
          name: call.function.name,
          arguments: args,
          result,
        });
      }
    }

    if (!stepCalled) {
      const result = await executeTool(this.client, 'step', {
        ticks: options.ticks ?? this.ticksPerTurn,
      });
      turnTrace.push({
        role: 'tool',
        name: 'step',
        arguments: { ticks: options.ticks ?? this.ticksPerTurn },
        result,
      });
    }

    return turnTrace;
  }

  async explainTurn(turn) {
    const message = await this.llm.chat({
      messages: [
        {
          role: 'system',
          content:
            'You summarize a warehouse agent decision in one or two concise sentences in Chinese. Mention what changed and why it matters.',
        },
        {
          role: 'user',
          content: JSON.stringify(turn),
        },
      ],
      temperature: 0.3,
    });
    return message.content || '';
  }

  async run(options = {}) {
    const turns = options.turns ?? this.maxTurns;
    const result = [];
    for (let i = 0; i < turns; i += 1) {
      const output = await this.runTurn({
        ticks: options.ticks ?? this.ticksPerTurn,
      });
      result.push(output);
      const orders = output.world.orders
        ? Object.values(output.world.orders)
        : [];
      if (orders.length > 0 && orders.every((order) => order.state === 'completed')) {
        break;
      }
    }
    return result;
  }

  async close() {
    await this.client.close();
  }
}
