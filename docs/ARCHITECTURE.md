Dharma Events — Architecture Overview

Summary
- Monorepo (pnpm workspace) containing:
  - apps/api — Fastify server, Prisma DB access, authentication, import, reporting
  - apps/web — React (Vite), TanStack Query, UI routes
  - apps/worker — background jobs: invitation processing, mailer, retries
  - packages/database — Prisma schema, migrations, client wrapper
  - packages/shared — shared utilities: env loader, QR token, PDF helpers

Key design decisions
- Single Postgres database for all app data; Prisma manages schema and migrations.
- Invitation PDFs and per-event/category invite attachments stored as bytea in Postgres to avoid a shared filesystem between api and worker.
- Immutable audit log and checkin transaction rows to ensure an auditable history.
- Background jobs implemented in a worker process and scheduled via job rows (invitation_jobs) with nextAttemptAt + backoff.

Hotspots & operational notes
- DB growth: storing PDFs in Postgres can bloat backups. Consider object storage (S3/GCS) if attachment volume grows.
- Native module builds: @node-rs/argon2 and similar require CI builders per-target. Use matrix builds or prebuilt binaries.
- Security: ensure production release uses HTTPS, secure cookie flags (SameSite, Secure, HttpOnly), and strict CORS.

Simple ASCII diagram

  [Browser] <---> [Web (Vite / Nginx)] <---> [API (Fastify)] <---> [Postgres]
                                 \
                                  --> [Worker]

- Browser: UI, authentication, and check-in scanner
- Web: serves SPA and proxies /api to Fastify
- API: business logic, auth, uploads, audit logging
- Worker: processes invitation_jobs, sends email attachments

Recommended next steps
- Add monitoring/metrics (Prometheus + Grafana) for DB size, job queue latency, and mailer errors.
- Add retention/archival policy for invite attachments and old events.
- Add deployment manifests and an infra README (Helm / Docker Compose examples already in repo).
