"""End-to-end protocol / recording / replay checks, no third-party packages."""
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
binary = root / 'target/debug' / ('logistics.exe' if os.name == 'nt' else 'logistics')
output = root / 'output'
output.mkdir(exist_ok=True)
scenario = (root / 'examples/scenario.jsonl').read_text(encoding='utf-8')
run = subprocess.run([str(binary), '--record', 'output/scenario.replay.json'], input=scenario,
                     text=True, encoding='utf-8', cwd=root, capture_output=True, check=True)
responses = [json.loads(line) for line in run.stdout.splitlines()]
assert len(responses) == len(scenario.splitlines())
assert all(r['ok'] for r in responses), responses
replay = subprocess.run([str(binary), '--replay', 'output/scenario.replay.json'],
                        text=True, encoding='utf-8', cwd=root, capture_output=True, check=True)
assert json.loads(replay.stdout) == responses[-1]
assert responses[-1]['data']['kpis']['completed_orders'] == 1
errors = subprocess.run([str(binary)], input='broken\n{"op":"step","ticks":0}\n{"op":"get_kpis"}\n',
                        text=True, encoding='utf-8', cwd=root, capture_output=True, check=True)
assert [json.loads(line)['ok'] for line in errors.stdout.splitlines()] == [False, False, True]
bad_path = subprocess.run([str(binary), '--record', '../outside.json'], cwd=root, capture_output=True)
assert bad_path.returncode != 0
demo = subprocess.run([str(binary), '--demo', '--record', 'output/demo.replay.json'],
                      text=True, encoding='utf-8', cwd=root, capture_output=True, check=True)
kpis = json.loads(demo.stdout.splitlines()[-1])['data']
assert kpis['completed_orders'] == kpis['total_orders'] == 20
(output / 'demo-kpis.json').write_text(json.dumps(kpis, indent=2) + '\n', encoding='utf-8')
print('CLI smoke: PASS (fault recovery, 20-order demo, exact replay, errors, file boundary)')
