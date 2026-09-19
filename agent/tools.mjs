const position = {
  type: 'object',
  description: 'Grid position. x increases to the right, y increases downward.',
  properties: {
    x: { type: 'integer', minimum: 0, maximum: 255 },
    y: { type: 'integer', minimum: 0, maximum: 255 },
  },
  required: ['x', 'y'],
  additionalProperties: false,
};

const positionList = {
  type: 'array',
  items: position,
  uniqueItems: true,
};

const robotId = {
  type: 'integer',
  minimum: 1,
  maximum: 4294967295,
};

const orderId = {
  type: 'integer',
  minimum: 1,
  maximum: 4294967295,
};

const map = {
  type: 'object',
  properties: {
    width: { type: 'integer', minimum: 1, maximum: 256 },
    height: { type: 'integer', minimum: 1, maximum: 256 },
    obstacles: positionList,
    blocked: positionList,
  },
  required: ['width', 'height', 'obstacles'],
  additionalProperties: false,
};

function tool(name, description, properties = {}, required = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

export const SIM_TOOLS = [
  tool('get_state', 'Read the complete simulation state: map, robots, orders, tick, strategy, events and heatmap.'),
  tool('get_kpis', 'Read current throughput, completion time, utilization, distance and wait metrics.'),
  tool('get_events', 'Read new domain events after an event sequence number.', {
    after: { type: 'integer', minimum: 0 },
  }),
  tool('reset', 'Replace the world with a new map and robot set. This resets tick and metrics.', {
    map,
    robots: { ...positionList, minItems: 1, maxItems: 64 },
    seed: { type: 'integer', minimum: 0 },
  }, ['map', 'robots', 'seed']),
  tool('add_order', 'Add one order with a pickup cell, dropoff cell and optional priority.', {
    pickup: position,
    dropoff: position,
    priority: { type: 'integer', minimum: 0, maximum: 9 },
  }, ['pickup', 'dropoff']),
  tool('generate_orders', 'Generate random connected orders using the fixed simulator seed.', {
    count: { type: 'integer', minimum: 1, maximum: 1000 },
  }, ['count']),
  tool('set_strategy', 'Set baseline dispatch strategy. Use manual when the agent owns decisions.', {
    strategy: { type: 'string', enum: ['nearest', 'balanced', 'manual'] },
  }, ['strategy']),
  tool('dispatch', 'Immediately assign pending orders using the current baseline strategy.'),
  tool('assign_order', 'Assign a pending order to an idle robot.', {
    robot_id: robotId,
    order_id: orderId,
  }, ['robot_id', 'order_id']),
  tool('plan_path', 'Plan a shortest path from start to goal, optionally avoiding extra cells.', {
    start: position,
    goal: position,
    avoid: positionList,
  }, ['start', 'goal']),
  tool('replan', 'Replan the current path for a robot that already has an active order.', {
    robot_id: robotId,
    avoid: positionList,
  }, ['robot_id']),
  tool('set_blocked', 'Block or unblock a floor cell. Cannot block a cell currently occupied by a robot.', {
    position,
    blocked: { type: 'boolean' },
  }, ['position', 'blocked']),
  tool('inject_fault', 'Force a robot into the faulted state. Its unfinished order returns to pending.', {
    robot_id: robotId,
  }, ['robot_id']),
  tool('repair_robot', 'Repair a faulted robot and make it idle again.', {
    robot_id: robotId,
  }, ['robot_id']),
  tool('step', 'Advance the simulation by the given number of ticks. Only step advances time.', {
    ticks: { type: 'integer', minimum: 1, maximum: 10000 },
  }, ['ticks']),
];

const names = new Set(SIM_TOOLS.map((entry) => entry.function.name));

export async function executeTool(client, name, args = {}) {
  if (!names.has(name)) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }
  try {
    const data = await client.call(name, args);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
