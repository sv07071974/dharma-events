import type { PrismaClient, User } from '@dharma-events/database';
import { generateSessionToken, hashSessionToken } from './tokens.js';

export interface CreateSessionResult {
  rawToken: string;
  expiresAt: Date;
}

export interface SessionMetadata {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Creates a new server-side session row and returns the raw token to be set
 * in the session cookie. Only the SHA-256 hash of the token is persisted.
 */
export async function createSession(
  prisma: PrismaClient,
  userId: string,
  ttlHours: number,
  metadata: SessionMetadata = {},
): Promise<CreateSessionResult> {
  const rawToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(rawToken),
      userId,
      expiresAt,
      ipAddress: metadata.ipAddress ?? null,
      userAgent: metadata.userAgent ?? null,
    },
  });

  return { rawToken, expiresAt };
}

/**
 * Resolves a raw session token (from the cookie) to its owning, still-active
 * user. Returns null if the token is missing, expired, or the user is
 * inactive - callers must treat that the same as "not authenticated".
 */
export async function resolveSessionUser(
  prisma: PrismaClient,
  rawToken: string | undefined,
): Promise<User | null> {
  if (!rawToken) {
    return null;
  }

  const tokenHash = hashSessionToken(rawToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.active) {
    return null;
  }

  return session.user;
}

export async function destroySession(prisma: PrismaClient, rawToken: string): Promise<void> {
  const tokenHash = hashSessionToken(rawToken);
  await prisma.session.deleteMany({ where: { tokenHash } });
}
