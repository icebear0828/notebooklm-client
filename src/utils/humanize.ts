/**
 * Humanization utilities for adding jitter to delays and increments.
 */

export function jitteredDelay(baseMs: number, jitter = 0.3): number {
  const factor = 1 + (Math.random() * 2 - 1) * jitter;
  return Math.round(baseMs * factor);
}

export function humanSleep(baseMs: number, jitter = 0.3): Promise<void> {
  const ms = jitteredDelay(baseMs, jitter);
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function jitteredIncrement(base: number, jitter = 0.3): number {
  const factor = 1 + (Math.random() * 2 - 1) * jitter;
  return Math.round(base * factor);
}
