import { createHash, randomBytes } from 'node:crypto';

/**
 * Session token generation/hashing, mirroring the QR token security design
 * in REQUIREMENTS.md Section 13: the server only ever stores a SHA-256 hash
 * of the token, never the raw value, and the raw value is never logged.
 */

const SESSION_TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
