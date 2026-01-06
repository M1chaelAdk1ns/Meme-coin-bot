import crypto from 'crypto';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const dedupeKey = (parts: (string | number)[]) =>
  crypto.createHash('sha256').update(parts.join(':')).digest('hex');

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * A lightweight rolling dedupe cache (fixed memory) for high-frequency events.
 * - O(1) average checks
 * - bounded size
 */
export class RollingDedupe {
  private set = new Set<string>();
  private queue: string[] = [];

  constructor(private maxSize: number = 5000) {}

  has(key: string) {
    return this.set.has(key);
  }

  add(key: string) {
    if (this.set.has(key)) return;
    this.set.add(key);
    this.queue.push(key);

    while (this.queue.length > this.maxSize) {
      const old = this.queue.shift();
      if (old) this.set.delete(old);
    }
  }

  size() {
    return this.set.size;
  }
}

/**
 * Shared runtime flags (in-memory). Keep this tiny.
 * Telegram will toggle these, runner will check them.
 */
export const runtimeFlags = {
  entriesPaused: false
};
