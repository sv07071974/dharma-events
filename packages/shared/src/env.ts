import { z } from 'zod';

/**
 * Environment variable schema shared by the API and worker services.
 * Fails fast on startup if required configuration is missing or malformed.
 * See REQUIREMENTS.md Section 68 (Configuration).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  APP_NAME: z.string().default('Dharma Events'),
  PUBLIC_URL: z.string().url().default('http://localhost:8088'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),

  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),

  // Login attempt throttling (REQUIREMENTS.md Section 36 - brute-force
  // protection). Configurable so integration tests exercising many
  // sequential logins aren't throttled by the same limits used in
  // production.
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().optional().default(587),
  SMTP_SECURE: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .default(false)
    .transform((v) => v === true || v === 'true'),
  SMTP_USERNAME: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM_EMAIL: z.string().optional().default(''),
  SMTP_FROM_NAME: z.string().optional().default(''),

  QR_TOKEN_BYTES: z.coerce.number().int().positive().default(24),

  EMAIL_WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  EMAIL_MAX_RETRIES: z.coerce.number().int().nonnegative().default(4),

  // Invitation email recipient rules (REQUIREMENTS.md Section 20). Not in
  // the spec's literal Section 68 env var list; added because CC behaviour
  // must be configurable per deployment. Volunteer CC defaults to the
  // spec's recommendation (optional/off); the shared mailbox is disabled by
  // default and only used as a fallback per the spec's recommendation.
  INVITATION_CC_VOLUNTEER: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .default(false)
    .transform((v) => v === true || v === 'true'),
  INVITATION_CC_REGISTRATION_MAILBOX: z.string().optional().default(''),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env`-like input. Throws with a readable
 * message listing every problem instead of failing on the first one.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
