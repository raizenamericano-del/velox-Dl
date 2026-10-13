'use strict';

/**
 * Counting semaphore. Keeps the number of simultaneous engine processes bounded
 * so a traffic spike cannot OOM a small instance.
 */
class Semaphore {
  constructor(max = 4) { this.max = max; this.active = 0; this.queue = []; }

  async acquire(timeoutMs = 30_000) {
    if (this.active < this.max) { this.active++; return; }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.queue.indexOf(entry);
        if (i >= 0) this.queue.splice(i, 1);
        reject(new Error('timed out waiting for a free engine slot'));
      }, timeoutMs);
      const entry = { resolve: () => { clearTimeout(timer); resolve(); } };
      this.queue.push(entry);
    });
    this.active++;
  }

  release() {
    this.active = Math.max(this.active - 1, 0);
    const next = this.queue.shift();
    if (next) next.resolve();
  }

  get pending() { return this.queue.length; }
}

module.exports = { Semaphore };
