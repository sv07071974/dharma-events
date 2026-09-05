/**
 * Computes the delay (ms) before the worker's next polling cycle.
 * Extracted as a pure function so it is testable without timers/IO.
 */
export function nextPollDelayMs(baseIntervalMs: number, hasPendingWork: boolean): number {
  if (baseIntervalMs <= 0) {
    throw new Error('baseIntervalMs must be positive');
  }
  // Poll immediately-ish when there is known pending work, otherwise back off.
  return hasPendingWork ? Math.min(baseIntervalMs, 1000) : baseIntervalMs;
}
