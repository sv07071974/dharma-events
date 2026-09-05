import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing using Argon2id (the preferred algorithm per
 * REQUIREMENTS.md Section 34 - Authentication). Default cost parameters
 * from @node-rs/argon2 already follow OWASP-recommended minimums.
 */

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword);
}

export async function verifyPassword(passwordHash: string, plainPassword: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plainPassword);
  } catch {
    // A malformed/legacy hash should never crash the login flow.
    return false;
  }
}
