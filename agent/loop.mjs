import { CONFIG } from './config.mjs';
import { LLMClient } from './llm.mjs';
import { RulePolicy } from './policy.mjs';
import { SimulationClient } from './sim-client.mjs';
import { SIM_TOOLS, executeTool, getTools } from './tools.mjs';
import {
  buildSystemPrompt,
  buildUserMessage,
  collectObservation,
} from './observation.mjs';
import { MULTI_AGENT_DEFS } from './agents.mjs';
import { agentForTrigger, classifyTrigger, eventBrief, explainDecision, headOnYielders } from './events.mjs';

const READ_ONLY_TOOLS = new Set(['get_state', 'get_kpis', 'get_events']);
const MODEL_EVENTS = new Set(['fault', 'congestion', 'order_surge']);

function focusObservation(observation) {
  const world = observation.world || {};
  const orders = {};
  for (const order of Object.values(world.orders || {})) {
    if (order.state === 'pending' || order.state === 'assigned' || order.state === 'in_transit') {
      orders[order.id] = order;
    }
  }
  return {
    ...observation,
    world: { ...world, orders },
    events: (observation.events || []).slice(-8),
  };
}

function tagTrace(items, via) {
  return items.map((item) => ({ ...item, via }));
}

function blockingLlmError(trace) {
  const acted = trace.some((item) => item.role === 'tool' || item.name);
  if (acted) return null;
  return trace.find((item) => item.role === 'error')?.error || null;
}

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
    this.architecture = options.architecture ?? CONFIG.architecture;
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
    this.handledFaults = new Set();
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
    this.handledFaults = new Set();
    return this.observe();
  }

  async restore(saved) {
    if (!this.client.started) await this.start();
    const world = saved?.world;
    if (!world?.map || !world.robots) throw new Error('快照里没有完整仓库');
    await this.client.call('restore', { world });
    const events = Array.isArray(world.events) ? world.events : [];
    const lastSequence = events.at(-1)?.sequence;
    this.eventAfter = Number.isInteger(saved.eventAfter)
      ? saved.eventAfter
      : (Number.isInteger(lastSequence) ? lastSequence : 0);
    this.trace = Array.isArray(saved.trace) ? saved.trace.slice(-200) : [];
    this.handledFaults = new Set(
      (Array.isArray(saved.handledFaults) ? saved.handledFaults : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    );
    return this.observe();
  }

  async runTurn(options = {}) {
    if (!this.client.started) await this.start();
    const before = await this.observe();
    const turnTrace =
      this.mode === 'llm'
        ? options.fast
          ? await this.runFastLlmTurn(before, options)
          : this.architecture === 'multi'
            ? await this.runMultiLlmTurn(before, options)
            : await this.runLlmTurn(before, options)
        : await this.policy.decide(this.client, before.world);

    const after = await this.observe();
    const primary = Array.isArray(turnTrace) ? turnTrace[0] : null;
    const turn = {
      tick: after.world.tick,
      mode: this.mode,
      trigger: primary?.trigger || null,
      explanation: primary?.explanation || null,
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

    const blocked = blockingLlmError(turnTrace);
    if (blocked) throw new Error(blocked);

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

  async runAgent(definition, observation, extraContext = '', maxRounds = this.maxToolCalls, timeoutMs = 0, stopWhenActed = false) {
    const tools = getTools(definition.tools);
    const messages = [
      { role: 'system', content: definition.system },
      {
        role: 'user',
        content: [buildUserMessage(observation), extraContext]
          .filter(Boolean)
          .join('\n\n'),
      },
    ];
    const trace = [];
    let report = '';
    let stepCalled = false;

    const rounds = Math.max(1, Math.min(this.maxToolCalls, maxRounds));
    for (let i = 0; i < rounds; i += 1) {
      let message;
      try {
        message = await this.llm.chat({
          messages,
          tools,
          toolChoice: tools.length ? 'auto' : undefined,
          timeoutMs,
        });
      } catch (error) {
        trace.push({ role: 'error', error: error.message });
        break;
      }

      const toolCalls = message.tool_calls || [];
      if (message.content) report = message.content;
      messages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      });

      if (toolCalls.length === 0) {
        trace.push({ role: 'assistant', content: message.content || '' });
        break;
      }

      let mutating = false;
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
        if (!READ_ONLY_TOOLS.has(call.function.name)) mutating = true;
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
        trace.push({
          role: 'tool',
          name: call.function.name,
          arguments: args,
          result,
        });
      }
      if (
        stopWhenActed
        && trace.some((item) => item.result?.ok && (item.name === 'assign_order' || item.name === 'replan'))
      ) break;
      if (!mutating) break;
    }

    return {
      id: definition.id,
      name: definition.name,
      report,
      trace,
      stepCalled,
    };
  }

  async runMultiLlmTurn(before, options = {}) {
    const observer = await this.runAgent(MULTI_AGENT_DEFS[0], before, '', 1);

    const router = await this.runAgent(
      MULTI_AGENT_DEFS[1],
      before,
      `观察诊断 Agent 报告：\n${observer.report}`,
      3,
    );

    const afterRouter = await this.observe();
    const routerActions = router.trace
      .filter((item) => item.role === 'tool')
      .map((item) => `${item.name}(${JSON.stringify(item.arguments)})`)
      .join('; ');

    const dispatcher = await this.runAgent(
      MULTI_AGENT_DEFS[2],
      afterRouter,
      `观察诊断 Agent 报告：\n${observer.report}\n\n路径 Agent 已执行动作：\n${
        routerActions || '无'
      }`,
      3,
    );

    const blocked = [observer, router, dispatcher]
      .map((agent) => blockingLlmError(agent.trace))
      .filter(Boolean);
    if (blocked.length === 3) throw new Error(blocked[0]);

    if (!dispatcher.stepCalled) {
      const result = await executeTool(this.client, 'step', {
        ticks: options.ticks ?? this.ticksPerTurn,
      });
      dispatcher.trace.push({
        role: 'tool',
        name: 'step',
        arguments: { ticks: options.ticks ?? this.ticksPerTurn },
        result,
      });
    }

    return [
      { agent: observer.id, name: observer.name, report: observer.report, actions: observer.trace },
      { agent: router.id, name: router.name, report: router.report, actions: router.trace },
      { agent: dispatcher.id, name: dispatcher.name, report: dispatcher.report, actions: dispatcher.trace },
    ];
  }

  async runFastLlmTurn(before, options = {}) {
    const robots = Object.values(before.world?.robots || {});
    for (const id of [...this.handledFaults]) {
      const robot = robots.find((item) => item.id === id);
      if (!robot || robot.state !== 'faulted') this.handledFaults.delete(id);
    }
    let trigger = classifyTrigger(before.world, this.handledFaults);
    if (options.surge && trigger?.type === 'dispatch') {
      trigger = {
        ...trigger,
        type: 'order_surge',
        title: '订单突发',
        detail: `${trigger.detail}，按这次注入的突发订单分配`,
      };
    }
    if (!trigger) {
      const result = await executeTool(this.client, 'step', {
        ticks: options.ticks ?? this.ticksPerTurn,
      });
      return [{
        agent: 'sim',
        name: '仿真推进',
        report: '',
        actions: [{ role: 'tool', name: 'step', arguments: { ticks: options.ticks ?? this.ticksPerTurn }, result }],
      }];
    }

    const definition = agentForTrigger(trigger);
    const trace = [];
    let source = 'rule';
    let report = '';
    if (MODEL_EVENTS.has(trigger.type) && this.llm) {
      const agent = await this.runAgent(
        definition,
        focusObservation(before),
        eventBrief(trigger, before.world),
        2,
        CONFIG.eventTimeoutMs,
        true,
      );
      report = agent.report || '';
      trace.push(...tagTrace(agent.trace, 'model'));
      const useful = trace.some((item) => (
        item.result?.ok
        && (item.name === 'assign_order' || item.name === 'replan')
      ));
      if (useful) {
        source = 'model';
      } else {
        source = 'fallback';
        trace.push(...tagTrace(await this.localReaction(trigger, before.world), 'rule'));
      }
    } else {
      trace.push(...tagTrace(await this.localReaction(trigger, before.world), 'rule'));
    }

    if (trigger.type === 'congestion' || (source === 'model' && trigger.type !== 'congestion')) {
      trace.push(...tagTrace(await this.assignByBalance(), 'rule'));
    }
    if (trigger.type === 'fault') {
      for (const robot of robots) {
        if (robot.state === 'faulted') this.handledFaults.add(robot.id);
      }
    }

    const result = await executeTool(this.client, 'step', {
      ticks: options.ticks ?? this.ticksPerTurn,
    });
    trace.push({
      role: 'tool',
      name: 'step',
      arguments: { ticks: options.ticks ?? this.ticksPerTurn },
      result,
    });

    return [{
      agent: definition.id,
      name: definition.name,
      report,
      trigger,
      explanation: explainDecision(trigger, trace, source),
      actions: trace,
    }];
  }

  async localReaction(trigger, world) {
    if (trigger.type === 'congestion') return this.rerouteSome(world);
    return this.assignByBalance();
  }

  async rerouteSome(world) {
    const yielders = headOnYielders(Object.values(world?.robots || {}));
    const extra = [];
    for (const item of yielders) {
      const avoid = [item.avoid];
      const result = await executeTool(this.client, 'replan', { robot_id: item.id, avoid });
      extra.push({
        role: 'tool',
        name: 'replan',
        arguments: { robot_id: item.id, avoid },
        result,
      });
    }
    return extra;
  }

  async assignByBalance() {
    const state = await this.client.call('get_state');
    const idle = Object.values(state.world.robots || {}).filter((robot) => robot.state === 'idle');
    const pending = Object.values(state.world.orders || {})
      .filter((order) => order.state === 'pending')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id - b.id);
    const extra = [];
    const used = new Set();
    const cost = (robot, order) => (
      Math.abs(robot.position.x - order.pickup.x)
      + Math.abs(robot.position.y - order.pickup.y)
      + (robot.completed_orders || 0) * 4
    );
    for (const order of pending) {
      const free = idle.filter((robot) => !used.has(robot.id));
      if (!free.length) break;
      const robot = free.sort((a, b) => cost(a, order) - cost(b, order) || a.id - b.id)[0];
      const arguments_ = { robot_id: robot.id, order_id: order.id };
      const result = await executeTool(this.client, 'assign_order', arguments_);
      extra.push({ role: 'tool', name: 'assign_order', arguments: arguments_, result });
      if (result?.ok === false) continue;
      used.add(robot.id);
    }
    return extra;
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
