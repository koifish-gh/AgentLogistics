import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { BINARY_PATH, ROOT_DIR } from './config.mjs';

export class SimulationClient {
  constructor({ binary = BINARY_PATH, cwd = ROOT_DIR } = {}) {
    this.binary = binary;
    this.cwd = cwd;
    this.process = null;
    this.queue = [];
    this.stderr = '';
    this.started = false;
    this.starting = null;
  }

  start() {
    if (this.started) return this.starting;
    this.started = true;
    this.starting = new Promise((resolve, reject) => {
      const child = spawn(this.binary, [], {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.process = child;
      let spawned = false;

      child.on('error', (error) => {
        const message = new Error(
          `Cannot start simulation process: ${error.message}`,
        );
        this.fail(message);
        if (!spawned) reject(message);
      });

      child.once('spawn', () => {
        spawned = true;
        resolve();
      });

      child.stderr.on('data', (chunk) => {
        this.stderr += chunk.toString();
      });

      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        const job = this.queue.shift();
        if (!job) return;
        try {
          const parsed = JSON.parse(line);
          if (parsed.ok) {
            job.resolve(parsed.data);
          } else {
            const error = parsed.error || {};
            job.reject(
              new Error(
                `${error.code || 'simulation_error'}: ${error.message || 'unknown error'}`,
              ),
            );
          }
        } catch (error) {
          job.reject(new Error(`Invalid simulator response: ${error.message}`));
        }
      });

      child.on('exit', (code) => {
        this.fail(
          new Error(
            `Simulation process exited with code ${code}${
              this.stderr ? `\n${this.stderr.trim()}` : ''
            }`,
          ),
        );
      });

      resolve();
    });
    return this.starting;
  }

  fail(error) {
    for (const job of this.queue.splice(0)) {
      job.reject(error);
    }
  }

  async call(op, args = {}) {
    await this.start();
    if (!this.process || this.process.exitCode !== null) {
      throw new Error('Simulation process is not running');
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.process.stdin.write(`${JSON.stringify({ op, ...args })}\n`, (error) => {
        if (error) {
          const index = this.queue.findIndex((job) => job.resolve === resolve);
          if (index >= 0) this.queue.splice(index, 1);
          reject(error);
        }
      });
    });
  }

  async close() {
    if (!this.process) return;
    const process = this.process;
    this.process = null;
    this.started = false;
    this.starting = null;
    if (process.exitCode === null) {
      process.stdin.end();
      process.kill();
    }
  }
}
