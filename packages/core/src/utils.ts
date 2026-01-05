import crypto from 'crypto';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const dedupeKey = (parts: (string | number)[]) =>
  crypto.createHash('sha256').update(parts.join(':')).digest('hex');

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
