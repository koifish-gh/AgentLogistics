function compactRobot(robot) {
  return {
    id: robot.id,
    position: robot.position,
    state: robot.state,
    order_id: robot.order_id,
    path_len: Array.isArray(robot.path) ? robot.path.length : 0,
    distance: robot.distance,
    wait_ticks: robot.wait_ticks,
    consecutive_waits: robot.consecutive_waits,
    completed_orders: robot.completed_orders,
  };
}

function compactOrder(order) {
  return {
    id: order.id,
    pickup: order.pickup,
    dropoff: order.dropoff,
    priority: order.priority,
    state: order.state,
    robot_id: order.robot_id,
    created_at: order.created_at,
    completed_at: order.completed_at,
    recovery_from: order.recovery_from,
  };
}

function hotspots(heatmap, limit = 10) {
  const cells = [];
  for (let y = 0; y < heatmap.length; y += 1) {
    for (let x = 0; x < heatmap[y].length; x += 1) {
      if (heatmap[y][x] > 0) {
        cells.push({ x, y, count: heatmap[y][x] });
      }
    }
  }
  cells.sort((a, b) => b.count - a.count || a.y - b.y || a.x - b.x);
  return cells.slice(0, limit);
}

export function compactWorld(world) {
  return {
    tick: world.tick,
    strategy: world.strategy,
    map: {
      width: world.map.width,
      height: world.map.height,
      obstacles: world.map.obstacles,
      blocked: world.map.blocked,
    },
    robots: Object.values(world.robots).map(compactRobot),
    orders: Object.values(world.orders).map(compactOrder),
    hotspots: hotspots(world.heatmap),
  };
}

export async function collectObservation(client, after, eventLimit = 60) {
  const state = await client.call('get_state');
  const events = await client.call('get_events', { after });
  const latest = events.length ? events[events.length - 1].sequence : after;
  return {
    world: state.world,
    kpis: state.kpis,
    events: events.slice(-eventLimit),
    after: latest,
  };
}

export function buildSystemPrompt() {
  return [
    'You are the decision brain of a small warehouse robot simulation.',
    'You are not an assistant that explains code; you control the world by calling tools.',
    'The simulator is synchronous: robots move at most one grid cell per tick.',
    'Every robot can carry at most one order. Only idle robots can receive orders.',
    'The simulation already runs in manual mode, so baseline dispatching is disabled.',
    'You must assign pending orders, replan blocked robots, repair faults when useful, and advance time with the step tool.',
    'Priorities are 0-9 and higher priority should normally be handled earlier.',
    'Prefer small, correct actions over guessing. If a tool fails, read the returned error and adjust.',
    'Do not call the same failing action repeatedly without changing inputs.',
    'Always end a decision cycle by calling step with ticks 1 unless you have a clear reason not to.',
    'Return tool calls only; avoid long prose unless you are summarizing a completed decision.',
  ].join('\n');
}

export function buildUserMessage(observation) {
  const snapshot = {
    kpis: observation.kpis,
    world: compactWorld(observation.world),
    recent_events: observation.events.map((event) => ({
      sequence: event.sequence,
      tick: event.tick,
      kind: event.kind,
      robot_id: event.robot_id,
      order_id: event.order_id,
      detail: event.detail,
    })),
  };
  return `Current world snapshot:\n${JSON.stringify(snapshot)}`;
}
