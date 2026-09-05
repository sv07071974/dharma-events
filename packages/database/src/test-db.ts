import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

export interface TestDatabase {
  databaseUrl: string;
  stop: () => Promise<void>;
}

/**
 * Boots an ephemeral, disposable PostgreSQL instance (via `embedded-postgres`)
 * in a temp directory and applies every committed Prisma migration to it with
 * `prisma migrate deploy` - the same command used in production. Intended for
 * integration tests only; never use in production or long-running dev
 * environments (see `compose.dev.yml` / README for the normal local
 * PostgreSQL setup).
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const port = 40000 + Math.floor(Math.random() * 20000);
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dharma-events-test-pg-'));
  const databaseName = 'dharma_events_test';

  // Force the embedded Postgres cluster (and this process) onto UTC. Without
  // this, `initdb` picks up the host machine's local time zone (this sandbox
  // runs Asia/Dubai, UTC+4), which becomes the *session* default timezone -
  // meaning `NOW()`/`CURRENT_TIMESTAMP` used as column defaults on
  // "timestamp without time zone" columns get stored as local wall-clock
  // time. Prisma always treats those columns as UTC when reading them back,
  // so without this fix, DB-computed timestamps would silently drift hours
  // ahead of real UTC in tests. Production containers (see compose.yml) are
  // unaffected: the official `postgres` Docker image defaults to UTC
  // regardless of the Docker host's time zone.
  process.env.TZ = 'UTC';

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(databaseName);

  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/${databaseName}`;

  execFileSync(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'deploy', '--schema', path.join(packageRoot, 'prisma/schema.prisma')],
    {
      cwd: packageRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    },
  );

  return {
    databaseUrl,
    async stop() {
      await pg.stop();
      fs.rmSync(databaseDir, { recursive: true, force: true });
    },
  };
}
