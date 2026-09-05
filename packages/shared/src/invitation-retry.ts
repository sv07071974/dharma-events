/**
 * Email retry backoff policy (REQUIREMENTS.md Section 21): attempt 1 is
 * immediate, then +1 minute, +5 minutes, +30 minutes. Indexed by the
 * 1-based attempt number that just failed.
 */
const RETRY_DELAYS_MS = [0, 60_000, 300_000, 1_800_000];

/**
 * Computes the delay before the next retry, given the attempt number that
 * just failed (1-based). Delays beyond the suggested schedule fall back to
 * the longest configured delay.
 */
export function retryDelayMs(failedAttemptNumber: number): number {
  if (!Number.isInteger(failedAttemptNumber) || failedAttemptNumber < 1) {
    throw new Error('failedAttemptNumber must be a positive integer');
  }
  const index = Math.min(failedAttemptNumber - 1, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
}
