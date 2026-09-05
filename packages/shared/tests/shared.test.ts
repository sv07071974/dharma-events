import { describe, expect, it } from 'vitest';
import { apiError, apiSuccess } from '../src/api-response.js';
import { loadEnv } from '../src/env.js';
import { formatRegistrationNumber } from '../src/registration-number.js';

describe('apiSuccess / apiError', () => {
  it('wraps data in a success envelope', () => {
    expect(apiSuccess({ ok: true })).toEqual({ success: true, data: { ok: true } });
  });

  it('wraps an error code/message in a failure envelope', () => {
    expect(apiError('NOT_FOUND', 'missing')).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    });
  });
});

describe('formatRegistrationNumber', () => {
  it('pads the sequence and prefixes the event code', () => {
    expect(formatRegistrationNumber('MDF26', 1)).toBe('MDF26-0001');
    expect(formatRegistrationNumber('MDF26', 42)).toBe('MDF26-0042');
  });

  it('rejects non-positive sequences', () => {
    expect(() => formatRegistrationNumber('MDF26', 0)).toThrow();
    expect(() => formatRegistrationNumber('MDF26', -1)).toThrow();
  });
});

describe('loadEnv', () => {
  it('parses a minimal valid environment', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/dharma',
      SESSION_SECRET: 'a'.repeat(32),
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.QR_TOKEN_BYTES).toBe(24);
  });

  it('throws a readable error when required fields are missing', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});
