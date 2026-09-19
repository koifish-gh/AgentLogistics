#!/usr/bin/env node
import { AgentBrain } from './loop.mjs';
import { CONFIG } from './config.mjs';

function readArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--mode') args.mode = argv[++i];
    else if (token === '--turns') args.turns = Number(argv[++i]);
    else if (token === '--ticks') args.ticks = Number(argv[++i]);
    else if (token === '--seed') args.seed = Number(argv[++i]);
    else if (token === '--orders') args.orders = Number(argv[++i]);
    else if (token === '--help') args.help = true;
    else args.command = token;
  }
  return args;
}

function help() {
  console.log(`AgentLogistics Agent Brain

Usage:
  node cli.mjs demo [--mode rule|llm] [--turns 300] [--ticks 1] [--seed 42] [--orders 20]
  node cli.mjs run  [--mode rule|llm] [--turns 300] [--ticks 1] [--seed 42]
  node cli.mjs help

Environment:
  AGENT_MODE           rule or llm. Defaults to rule without OPENAI_API_KEY.
  OPENAI_API_KEY       OpenAI-compatible API key.
  OPENAI_BASE_URL      Defaults to https://api.openai.com/v1
  OPENAI_MODEL         Defaults to gpt-4o-mini
  AGENT_TICKS_PER_TURN Defaults to 1
  AGENT_MAX_TOOL_CALLS Defaults to 12
  AGENT_EXPLAIN        true to add a natural-language explanation per turn.
`);
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    help();
    return;
  }

  const brain = new AgentBrain({
    mode: args.mode || CONFIG.mode,
    ticksPerTurn: args.ticks || CONFIG.ticksPerTurn,
  });

  try {
    await brain.start();
    await brain.reset({ seed: args.seed ?? 42 });
    if (args.command === 'demo') {
      await brain.client.call('generate_orders', {
        count: args.orders ?? 20,
      });
    }
    const outputs =
      args.command === 'demo'
        ? await brain.run({ turns: args.turns || 300 })
        : await brain.run({ turns: args.turns || 1 });
    const last = outputs.at(-1);
    console.log(
      JSON.stringify(
        {
          mode: brain.mode,
          turns: outputs.length,
          tick: last.world.tick,
          kpis: last.kpis,
          completed_orders:
            last.world.orders &&
            Object.values(last.world.orders).filter(
              (order) => order.state === 'completed',
            ).length,
          last_turn: last.turn,
        },
        null,
        2,
      ),
    );
  } finally {
    await brain.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
