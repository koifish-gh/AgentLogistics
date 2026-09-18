"""A 同学接入示例：仅标准库，无 LLM / API key 依赖。"""
import json
import subprocess
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]

class SimulationClient:
    def __init__(self):
        binary = ROOT / 'target/debug' / ('logistics.exe' if os.name == 'nt' else 'logistics')
        self.process = subprocess.Popen([str(binary)], cwd=ROOT, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, text=True, encoding='utf-8')

    def call(self, op, **arguments):
        self.process.stdin.write(json.dumps({'op': op, **arguments}) + '\n')
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError('Simulation process exited')
        response = json.loads(line)
        if not response['ok']:
            raise ValueError(response['error'])
        return response['data']

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=10)
        self.process.stdout.close()

if __name__ == '__main__':
    client = SimulationClient()
    try:
        client.call('set_strategy', strategy='manual')
        order = client.call('add_order', pickup={'x': 1, 'y': 0}, dropoff={'x': 11, 'y': 0})
        client.call('assign_order', robot_id=1, order_id=order['order_id'])
        client.call('step', ticks=3)
        client.call('inject_fault', robot_id=1)
        client.call('assign_order', robot_id=2, order_id=order['order_id'])
        client.call('step', ticks=20)
        print(json.dumps(client.call('get_kpis'), ensure_ascii=False, indent=2))
    finally:
        client.close()
