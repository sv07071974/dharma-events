import { loadEnv } from '@dharma-events/shared';
import { getPrismaClient, Role } from '@dharma-events/database';
import { createUserSchema } from '../auth/schemas.js';
import { hashPassword } from '../auth/password.js';

/**
 * Admin bootstrap command (REQUIREMENTS.md Section 75 - Phase 1 acceptance
 * criteria requires an "Admin bootstrap command").
 *
 * Usage:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=... ADMIN_NAME="Admin" \
 *     pnpm --filter @dharma-events/api run bootstrap:admin
 *
 * Idempotent: if a user with ADMIN_EMAIL already exists, the command exits
 * successfully without making changes rather than erroring, so it is safe to
 * re-run during deployment.
 */
async function main(): Promise<void> {
  // Validates DATABASE_URL/SESSION_SECRET/etc. fail fast with a readable error.
  loadEnv();

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? 'Administrator';

  if (!email || !password) {
    console.error(
      'ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required to bootstrap an admin user.',
    );
    process.exitCode = 1;
    return;
  }

  const parsed = createUserSchema.safeParse({ email, password, name, role: Role.ADMIN });
  if (!parsed.success) {
    console.error(`Invalid admin user details:\n${parsed.error.issues.map((i) => `  - ${i.message}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  const prisma = getPrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      console.log(`Admin user "${parsed.data.email}" already exists - no changes made.`);
      return;
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({
      data: {
        email: parsed.data.email,
        name: parsed.data.name,
        passwordHash,
        role: Role.ADMIN,
      },
    });

    console.log(`Admin user created: ${user.email} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
