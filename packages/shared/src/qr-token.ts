import { randomBytes, createHash } from 'node:crypto';

/**
 * QR token generation/hashing per REQUIREMENTS.md Section 13 (QR Security
 * Design): a cryptographically random, URL-safe token is embedded in the QR
 * code; only its SHA-256 hash is ever persisted. The raw token must never be
 * stored, logged, or written to disk.
 */

/** Generates a cryptographically random, URL-safe QR token. */
export function generateQrToken(byteLength = 24): string {
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    // Section 13 recommends at least 128 bits (16 bytes) of randomness.
    throw new Error('byteLength must be an integer of at least 16 (128 bits)');
  }
  return randomBytes(byteLength).toString('base64url');
}

/** Hashes a raw QR token with SHA-256 for storage/lookup. */
export function hashQrToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Builds the public check-in URL a QR code encodes, e.g. `${publicUrl}/q/${token}`. */
export function buildQrUrl(publicUrl: string, token: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/q/${token}`;
}
