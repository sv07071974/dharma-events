Dharma Events — Quickstart

This quickstart helps developers get the project running locally.

Prerequisites
- Node.js 20+
- pnpm 10+ (use corepack to enable)
- Docker + Docker Compose for Postgres

Steps
1. Install toolchain:

```bash
corepack enable
corepack prepare pnpm@10.33.2 --activate
pnpm install
```

2. Copy env and edit values:

```bash
cp .env.example .env
# Edit DATABASE_URL, EMAIL_* and other required vars
```

3. Start development Postgres:

```bash
docker compose -f compose.dev.yml up -d
```

4. Run Prisma migrations:

```bash
pnpm --filter @dharma-events/database run prisma:migrate
```

5. Optional: bootstrap an admin user:

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=change_me ADMIN_NAME="Admin" \
  pnpm --filter @dharma-events/api run bootstrap:admin
```

6. Start the services (separate terminals recommended):

```bash
pnpm dev:api      # API on http://localhost:3000
pnpm dev:web      # Web app on http://localhost:5173
pnpm dev:worker   # Background worker
```

7. Run checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Common Troubleshooting
- "Invalid environment configuration": compare .env to .env.example; the loader prints which key is missing/malformed.
- pnpm install errors: ensure Node and pnpm versions match prerequisites.

Notes
- Use the CI workflow (.github/workflows/ci.yml) as a template for required checks in PRs.
- Backups: use ./scripts/backup.sh and restore via ./scripts/restore.sh (destructive).
