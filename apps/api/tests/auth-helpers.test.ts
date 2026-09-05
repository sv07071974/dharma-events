import { describe, expect, it } from 'vitest';
import { Role } from '@dharma-events/database';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { generateSessionToken, hashSessionToken } from '../src/auth/tokens.js';
import { roleSatisfies } from '../src/auth/rbac.js';

describe('password hashing', () => {
  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword(hash, 'correct-horse-battery-staple')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('never stores the plaintext password in the hash output', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).not.toContain('correct-horse-battery-staple');
  });

  it('does not throw on a malformed hash - it just returns false', async () => {
    await expect(verifyPassword('not-a-real-hash', 'anything')).resolves.toBe(false);
  });
});

describe('session tokens', () => {
  it('generates unique, URL-safe tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('hashes the same token deterministically', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('produces different hashes for different tokens', () => {
    expect(hashSessionToken('token-a')).not.toBe(hashSessionToken('token-b'));
  });
});

describe('roleSatisfies (ROLE+ authorization)', () => {
  it('allows a role to satisfy its own minimum', () => {
    expect(roleSatisfies(Role.VOLUNTEER, Role.VOLUNTEER)).toBe(true);
  });

  it('allows higher-ranked roles to satisfy a lower minimum', () => {
    expect(roleSatisfies(Role.SUPERVISOR, Role.VOLUNTEER)).toBe(true);
    expect(roleSatisfies(Role.EVENT_MANAGER, Role.SUPERVISOR)).toBe(true);
    expect(roleSatisfies(Role.ADMIN, Role.VOLUNTEER)).toBe(true);
  });

  it('rejects lower-ranked roles for a higher minimum', () => {
    expect(roleSatisfies(Role.VOLUNTEER, Role.SUPERVISOR)).toBe(false);
    expect(roleSatisfies(Role.SUPERVISOR, Role.ADMIN)).toBe(false);
  });
});
