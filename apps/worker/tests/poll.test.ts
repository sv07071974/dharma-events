import { describe, expect, it } from 'vitest';
import { nextPollDelayMs } from '../src/poll.js';

describe('nextPollDelayMs', () => {
  it('returns the base interval when there is no pending work', () => {
    expect(nextPollDelayMs(5000, false)).toBe(5000);
  });

  it('returns a shorter delay when work is pending', () => {
    expect(nextPollDelayMs(5000, true)).toBe(1000);
  });

  it('rejects a non-positive base interval', () => {
    expect(() => nextPollDelayMs(0, false)).toThrow();
  });
});
