import { AgentBrain } from './loop.mjs';

const brain = new AgentBrain({ mode: 'rule' });

try {
  await brain.start();
  await brain.reset({ seed: 7 });
  await brain.client.call('generate_orders', { count: 8 });
  await brain.run({ turns: 120 });
  const state = await brain.client.call('get_state');
  const completed = Object.values(state.world.orders).filter(
    (order) => order.state === 'completed',
  ).length;

  if (brain.trace.length === 0) {
    throw new Error('Agent trace should not be empty');
  }
  if (completed === 0) {
    throw new Error('Rule policy completed no orders');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        tick: state.world.tick,
        orders: state.world.orders.length,
        completed,
        kpis: state.kpis,
      },
      null,
      2,
    ),
  );
} finally {
  await brain.close();
}
