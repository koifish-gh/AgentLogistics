import { executeTool } from './tools.mjs';

function orderKey(order) {
  return [-order.priority, order.created_at, order.id];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export class RulePolicy {
  async decide(client, world) {
    const trace = [];
    const call = async (name, args = {}) => {
      const result = await executeTool(client, name, args);
      trace.push({ name, arguments: args, result });
      return result;
    };

    for (const robot of Object.values(world.robots)) {
      if (robot.state === 'faulted') {
        await call('repair_robot', { robot_id: robot.id });
      }
    }

    const pending = Object.values(world.orders)
      .filter((order) => order.state === 'pending')
      .sort((a, b) => compareKeys(orderKey(a), orderKey(b)));
    const idle = Object.values(world.robots).filter(
      (robot) => robot.state === 'idle',
    );

    for (const order of pending) {
      if (idle.length === 0) break;
      const goals = order.recovery_from
        ? [order.recovery_from, order.pickup]
        : [order.pickup];
      let best = null;

      for (const robot of idle) {
        for (const goal of goals) {
          const planned = await call('plan_path', {
            start: robot.position,
            goal,
          });
          if (planned.ok) {
            const distance = planned.data.distance;
            if (!best || distance < best.distance) {
              best = { robot, distance };
            }
          }
        }
      }

      if (!best) continue;
      const assigned = await call('assign_order', {
        robot_id: best.robot.id,
        order_id: order.id,
      });
      if (assigned.ok) {
        idle.splice(
          idle.findIndex((robot) => robot.id === best.robot.id),
          1,
        );
      }
    }

    for (const robot of Object.values(world.robots)) {
      if (
        robot.order_id &&
        (robot.state === 'to_pickup' || robot.state === 'to_dropoff') &&
        robot.consecutive_waits >= 3
      ) {
        await call('replan', { robot_id: robot.id });
      }
    }

    await call('step', { ticks: 1 });
    return trace;
  }
}
