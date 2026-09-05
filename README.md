# Dharma Events

A lightweight, self-hosted event registration, QR check-in and attendance
platform. See `REQUIREMENTS.md` for the full product requirements and
technical design specification, and `docs/IMPLEMENTATION_STATUS.md` for
current build progress.

**Status:** All phases (0–9) complete, including Phase 9 (Event
Simulation) — see `docs/IMPLEMENTATION_STATUS.md`.

## Prerequisites

- Node.js 20+ (see `.nvmrc`)
- pnpm 10+ (`corepack enable` or `npm i -g pnpm`)
- Docker + Docker Compose (for PostgreSQL and/or full container deployment)

## Local Development

```bash
pnpm install
cp .env.example .env   # edit values as needed
docker compose -f compose.dev.yml up -d   # starts PostgreSQL only
```

Then, in separate terminals:

```bash
pnpm dev:api      # Fastify API on http://localhost:3000
pnpm dev:web      # Vite dev server on http://localhost:5173 (proxies /api)
pnpm dev:worker   # background worker
```

## Environment Variables

Copy `.env.example` to `.env` and fill in real values before running anything
other than the test suite. `packages/shared`'s `loadEnv()` validates the
environment at startup and fails fast with a readable error if a required
variable is missing or malformed. See REQUIREMENTS.md Section 68 for the full
variable reference.

## Database Setup

PostgreSQL is provisioned via Docker (`compose.dev.yml` for local development,
`compose.yml` for production). The connection string is read from
`DATABASE_URL`.

```bash
docker compose -f compose.dev.yml up -d
```

## Run Migrations

```bash
pnpm --filter @dharma-events/database run prisma:migrate
```

## Bootstrap the First Admin User

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=change_me ADMIN_NAME="Admin" \
  pnpm --filter @dharma-events/api run bootstrap:admin
```

Idempotent - safe to re-run; exits without changes if the email already
exists.

## Seed Data

Development seed scripts are introduced alongside the phases that need them
(see REQUIREMENTS.md Section 91). None exist yet in Phase 0.

## Run Web / API / Worker

See [Local Development](#local-development) above (`pnpm dev:web`,
`pnpm dev:api`, `pnpm dev:worker`).

## Run Tests

```bash
pnpm test        # Vitest unit/integration tests across all packages
pnpm lint        # ESLint across all packages
pnpm typecheck   # TypeScript project checks across all packages
```

End-to-end tests (Playwright) live in `e2e/` and run separately, since they
require a running browser and dev server:

```bash
cd e2e
pnpm exec playwright install --with-deps   # first run only
pnpm test:e2e
```

## Build Production

```bash
pnpm build
```

## Docker Compose

Production deployment uses `compose.yml`, which builds and runs `web`
(Nginx), `api`, `worker`, and `postgres` on an internal Docker network.
PostgreSQL is never published to the host or the internet.

```bash
cp .env.example .env   # edit with production values
docker compose up -d --build
docker compose exec api sh -c "cd /repo/packages/database && node_modules/.bin/prisma migrate deploy"
```

The `api`/`worker` containers deliberately do not run migrations
automatically on startup - the `prisma migrate deploy` step above is
required before first use, and after any update that includes new
migrations. See `docs/SYNOLOGY_DEPLOYMENT.md` for the full walkthrough.

## Synology Deployment

See `docs/SYNOLOGY_DEPLOYMENT.md` (added in Phase 8 - Production Hardening).

## Backup

```bash
./scripts/backup.sh
```

Runs `pg_dump` against the running `postgres` service, compresses it, and
rotates it into `$BACKUP_DIR/database/{daily,weekly,monthly}` (7/4/6
retention). Also snapshots `.env` and the Compose/Nginx configuration. See
`docs/SYNOLOGY_DEPLOYMENT.md` for scheduling it via cron/Task Scheduler.

## Restore

```bash
./scripts/restore.sh /path/to/dharma_events_TIMESTAMP.sql.gz
```

Destructive - drops and recreates the database schema before replaying the
dump. Requires typing the database name to confirm when run interactively;
pass `--yes` to skip the prompt for scripted restore drills.

## Troubleshooting

- **`Invalid environment configuration` on startup**: run `loadEnv()`'s error
  output through `.env.example` to find the missing/malformed variable.
- **Port 5173 or 3000 already in use**: stop any other local process bound to
  those ports, or override via the relevant tool's CLI flags.
- **`pnpm install` fails on a workspace package**: ensure you're on Node 20+
  and pnpm 10+ (`node -v`, `pnpm -v`).
