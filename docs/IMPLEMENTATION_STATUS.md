# Implementation Status

Tracks progress against the phased build plan in REQUIREMENTS.md Section 74
(Autonomous Build Plan).

## Phase 0 - Repository Bootstrap — IN PROGRESS

### Completed work

- Initialized git repository and pnpm workspace (`apps/*`, `packages/*`, plus a
  standalone `e2e/` Playwright package).
- Created `apps/web` (React 18 + TypeScript + Vite + vite-plugin-pwa +
  react-router-dom + TanStack Query), with a placeholder home route and a
  Vitest + Testing Library smoke test.
- Created `apps/api` (Fastify + TypeScript), with a `/api/health` endpoint
  returning the standard success envelope, and a Vitest integration test using
  Fastify's `.inject()`.
- Created `apps/worker` with a minimal polling-loop scaffold, environment
  validation, graceful shutdown handling, and a Vitest unit test for the pure
  polling-delay function.
- Created `packages/shared` with a Zod-based environment schema/loader
  (`loadEnv`), the standard API response envelope (`apiSuccess`/`apiError`),
  the `UserRole` enum, and a registration-number formatter, each with unit
  tests.
- Created `packages/database` with a Prisma `schema.prisma` wired to
  PostgreSQL via `DATABASE_URL` (no domain models yet — scheduled for Phase 1).
- Configured shared root-level TypeScript base config, ESLint 9 flat config,
  and Prettier.
- Configured Docker: `docker/web.Dockerfile`, `docker/api.Dockerfile`,
  `docker/worker.Dockerfile`, `docker/nginx.conf`, `compose.yml` (production,
  PostgreSQL internal-only) and `compose.dev.yml` (local Postgres-only
  overlay).
- Added `.env.example` covering every variable from REQUIREMENTS.md Section 68.
- Added `scripts/backup.sh` / `scripts/restore.sh` placeholders (full
  implementation is Phase 8 scope).
- Added `docs/ASSUMPTIONS.md` and this status file.
- Added root `README.md` with setup instructions.

### Tests executed

- `pnpm install` — see below for result.
- `pnpm lint` — see below for result.
- `pnpm typecheck` — see below for result.
- `pnpm test` (Vitest across `packages/shared`, `apps/api`, `apps/worker`,
  `apps/web`) — see below for result.
- `docker compose config` (syntax/validation only — Docker Engine is not
  available in this development environment, so `docker compose up` could not
  be executed here; validated on the target Synology NAS instead).

| Command | Result |
|---|---|
| `pnpm install` | ✅ Succeeded (691 packages resolved). |
| `pnpm lint` | ✅ Passed (`eslint src` clean across all 5 packages). |
| `pnpm typecheck` | ✅ Passed (`tsc --noEmit` clean across all 5 packages). |
| `pnpm test` | ✅ Passed — 11 tests total: `packages/shared` (6), `apps/api` (1), `apps/web` (1), `apps/worker` (3). `packages/database` has no tests yet (no models until Phase 1). |
| `pnpm build` | ✅ Succeeded for `apps/api`, `apps/worker` (tsc) and `apps/web` (Vite + PWA service worker generation). |
| Compose YAML validation | ✅ `compose.yml` and `compose.dev.yml` parse correctly and declare the expected services (`postgres`, `api`, `worker`, `web`; `postgres` only, respectively). Docker Engine itself is unavailable in this sandbox, so `docker compose up` was not executed here. |

Note: Vitest's default `forks` pool crashed when invoked recursively via
`pnpm -r` in this sandboxed environment (`RangeError: Maximum call stack size
exceeded` inside tinypool's child-process worker init) even though each
package's tests passed fine in isolation. Worked around by running all
packages' Vitest suites with `--pool=threads` instead of the default `forks`
pool; documented in docs/ASSUMPTIONS.md.

### Unresolved issues

- Docker Engine is unavailable in this sandbox, so `docker compose up` has
  only been syntax-validated (`docker compose config`), not run end-to-end.
  This must be verified on the Synology NAS (or any Docker host) before Phase 8
  sign-off.
- Real PWA icon assets (192px/512px PNG) are not yet included; a single SVG
  icon is used as a placeholder (see docs/ASSUMPTIONS.md).
- `pnpm-lock.yaml` is generated locally by `pnpm install` and is expected to be
  committed once dependencies are finalized for this phase.

### Next phase

Phase 1 — Database and Authentication (REQUIREMENTS.md Section 75): PostgreSQL
domain models via Prisma, migrations, users/roles, authentication, sessions,
and an admin bootstrap command.

## Phase 1 - Database and Authentication — COMPLETE

### Completed work

- Extended `packages/database/prisma/schema.prisma` with `Role` enum
  (`ADMIN`, `EVENT_MANAGER`, `SUPERVISOR`, `VOLUNTEER`), and `User`,
  `Session`, `AuditLog` models. Generated the initial migration via
  `prisma migrate diff` (see docs/ASSUMPTIONS.md for why `migrate dev` could
  not be used in this sandbox) and verified `prisma migrate deploy` +
  `prisma generate` apply cleanly.
- Added `packages/database/src/test-db.ts` (`startTestDatabase()`), exposed
  via a `./test-db` subpath export, using `embedded-postgres` to provide a
  real, ephemeral PostgreSQL instance for integration tests without Docker.
- Implemented the full auth module in `apps/api/src/auth/`: Argon2id password
  hashing (`password.ts`), session token generation/hashing (`tokens.ts`),
  role-hierarchy checks (`rbac.ts`), session lifecycle (`session-service.ts`),
  password-hash-stripping user sanitization (`public-user.ts`), Zod
  login/create-user schemas (`schemas.ts`), and append-only audit logging
  (`audit-log.ts`).
- Added Fastify plugins: `plugins/prisma.ts` (decorates `app.prisma`,
  accepts a `databaseUrl` override for testability) and `plugins/auth.ts`
  (session-cookie resolution, `app.authenticate`, `app.requireRole`,
  `app.config`).
- Added routes: `POST /api/v1/auth/login` (rate-limited, generic invalid-
  credentials message, sets an httpOnly/sameSite=lax session cookie),
  `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`, `GET /api/v1/users`
  (ADMIN only), `POST /api/v1/users` (ADMIN only, 409 on duplicate email).
- Rewrote `apps/api/src/app.ts` so `buildApp(env: Env)` takes an explicit,
  validated `Env` (needed so tests can point at an ephemeral test database);
  updated `server.ts` accordingly.
- Added `apps/api/src/cli/bootstrap-admin.ts`, an idempotent admin-bootstrap
  CLI script, and verified it end-to-end against an ephemeral database
  (create-then-rerun-is-a-no-op).
- Added `SESSION_TTL_HOURS`, `LOGIN_RATE_LIMIT_MAX`, and
  `LOGIN_RATE_LIMIT_WINDOW_MS` to `packages/shared/src/env.ts` and
  `.env.example` (documented in docs/ASSUMPTIONS.md).
- Added tests: `apps/api/tests/auth-helpers.test.ts` (unit tests for password
  hashing, session tokens, role hierarchy — 10 tests) and
  `apps/api/tests/auth.test.ts` (full integration suite against a real
  ephemeral PostgreSQL database covering login success/failure, `/me`,
  logout/session invalidation, RBAC on `/users`, duplicate-email conflict,
  and that no response ever contains `passwordHash` — 13 tests). Updated
  `apps/api/tests/health.test.ts` for the new `buildApp(env)` signature.

### Tests executed

| Command | Result |
|---|---|
| `pnpm install` | ✅ Up to date. |
| `pnpm -r lint` | ✅ Passed (`eslint src` clean across all 5 packages). |
| `pnpm -r typecheck` | ✅ Passed (`tsc --noEmit` clean across all 5 packages). |
| `pnpm --workspace-concurrency=1 -r test` | ✅ Passed — 34 tests total: `packages/shared` (6), `apps/api` (24: 10 auth-helper unit tests + 13 auth/RBAC integration tests + 1 health test), `apps/web` (1), `apps/worker` (3). `packages/database` has no unit tests of its own (`--passWithNoTests`; its logic is exercised indirectly by every `apps/api` integration test). |
| `pnpm -r build` | ✅ Succeeded for `apps/api`, `apps/worker` (tsc) and `apps/web` (Vite + PWA service worker generation). |
| `bootstrap:admin` CLI, end-to-end | ✅ Verified against an ephemeral `embedded-postgres` database: first run creates the admin user, second run is a no-op ("already exists"). |

### Unresolved issues

- No real Docker/Postgres verification of `prisma migrate deploy` has been
  done outside this sandbox; should be re-verified on the target Synology NAS
  / CI environment before Phase 8 sign-off (same caveat as Phase 0's Docker
  Compose validation).
- `AuditLog.eventId` intentionally deferred until the `Event` model exists in
  Phase 2.

### Next phase

Phase 2 — Event Management (REQUIREMENTS.md Section 76): Event, Category, and
Volunteer models, event configuration, and the associated CRUD APIs.

## Phase 2 - Event Management — COMPLETE

### Completed work

- Extended `packages/database/prisma/schema.prisma` with `EventStatus` enum
  (`DRAFT`/`ACTIVE`/`COMPLETED`/`ARCHIVED`) and `Event`, `Category`,
  `Volunteer` models; added `AuditLog.eventId` now that `Event` exists.
  Generated the migration via a pure schema-to-schema `prisma migrate diff`
  (no live DB connection required - see docs/ASSUMPTIONS.md for why the
  shadow-database approach used in Phase 1 had to change), verified against
  a fresh `embedded-postgres` instance, then ran `prisma generate`.
- Added `apps/api/src/events/schemas.ts` — Zod schemas for creating/updating
  events, categories, and volunteers.
- Added `apps/api/src/routes/events.ts` — full Event CRUD
  (`GET/POST /api/v1/events`, `GET/PATCH/DELETE /api/v1/events/:eventId`),
  ADMIN/EVENT_MANAGER+ for mutations, VOLUNTEER+ for reads, soft-delete
  (archive) instead of hard delete, 409 on duplicate `eventCode`.
- Added `apps/api/src/routes/categories.ts` — Category CRUD scoped per event
  (`GET/POST /api/v1/events/:eventId/categories`,
  `PATCH/DELETE /api/v1/categories/:categoryId`), EVENT_MANAGER+ for
  mutations, VOLUNTEER+ for reads, soft-delete (`active=false`), 409 on
  duplicate name within an event.
- Added `apps/api/src/routes/volunteers.ts` — Volunteer CRUD scoped per event
  (`GET/POST /api/v1/events/:eventId/volunteers`,
  `PATCH/DELETE /api/v1/volunteers/:volunteerId`), same RBAC/soft-delete
  pattern as categories.
- Wired all three new route modules into `apps/api/src/app.ts`.
- Added `apps/api/tests/events.test.ts` — 15 integration tests against a
  real ephemeral PostgreSQL database covering: RBAC (volunteer rejected,
  admin/event-manager allowed) on every mutation route, duplicate-code/name
  409 conflicts, 404s for unknown events, event archiving instead of hard
  delete, and category/volunteer soft-delete.
- Fixed a test-suite hang: `apps/api`'s Vitest config now runs with
  `--no-file-parallelism` because concurrent integration test files each
  spawning their own ephemeral `embedded-postgres` instance via synchronous
  child-process calls caused the whole suite to hang indefinitely.

### Tests executed

| Command | Result |
|---|---|
| `pnpm -r lint` | ✅ Passed (`eslint src` clean across all 5 packages). |
| `pnpm -r typecheck` | ✅ Passed (`tsc --noEmit` clean across all 5 packages). |
| `pnpm --workspace-concurrency=1 -r test` | ✅ Passed — 49 tests total: `packages/shared` (6), `apps/api` (39: 10 auth-helper unit tests + 13 auth/RBAC integration tests + 15 event/category/volunteer integration tests + 1 health test), `apps/web` (1), `apps/worker` (3). |
| `pnpm -r build` | ✅ Succeeded for `apps/api`, `apps/worker` (tsc) and `apps/web` (Vite + PWA service worker generation). |

### Unresolved issues

- Same Docker/Postgres-on-real-infrastructure caveat as Phases 0-1: only
  verified via `embedded-postgres` in this sandbox, not a real Docker host.
- No explicit "EVENT_MANAGER assigned to event" data model exists yet (see
  docs/ASSUMPTIONS.md); EVENT_MANAGER+ can manage every event for now.

### Next phase

Phase 3 — Registration Management (REQUIREMENTS.md Section 77): Registration
CRUD, Excel/CSV import with column mapping, validation, duplicate detection,
transactional import preview/commit, and registration ID generation.

## Phase 3 - Registration Management — COMPLETE

### Completed work

- Extended `packages/database/prisma/schema.prisma` with `InvitationStatus`
  (`NOT_SENT`/`PENDING`/`SENT`/`FAILED`) and `ValidationStatus`
  (`VALID`/`WARNING`/`ERROR`) enums, the `Registration` model (Section 12.5),
  and an `Event.registrationSeq` counter used for atomic registration-number
  generation. Migration generated via the same schema-to-schema diff
  workaround as Phase 2, verified against a fresh `embedded-postgres`
  instance.
- Added `apps/api/src/registrations/schemas.ts` — Zod schemas for manual
  registration create/update (registration number is never client-supplied)
  and the import column-mapping payload.
- Added `apps/api/src/registrations/import.ts` — pure spreadsheet parsing
  (`xlsx`, supports `.xlsx`/`.csv`), header auto-detection, per-row
  extraction/validation (Section 16 rules), and in-batch/against-DB
  duplicate detection.
- Added `apps/api/src/registrations/import-service.ts` — `previewImport()`
  (parses/validates without persisting) and `commitImport()` (single Prisma
  transaction; only non-ERROR rows are created; registration numbers are
  assigned atomically via a per-row `registrationSeq` increment; writes an
  `IMPORT_COMMIT` audit log entry).
- Added `apps/api/src/routes/registrations.ts` — registration CRUD/search
  scoped per event, with the same atomic registration-number generation for
  manual creates, category-must-belong-to-event validation on update, and an
  immutable registration number.
- Added `apps/api/src/routes/import.ts` — multipart preview/commit endpoints
  (`POST /api/v1/events/:eventId/import/preview`, `.../import/commit`),
  EVENT_MANAGER+, via `@fastify/multipart` (20 MB file limit).
- Wired the multipart plugin and both new route modules into
  `apps/api/src/app.ts`.
- Added `apps/api/tests/import.test.ts` (13 unit tests for the pure
  parsing/validation/dedup logic) and `apps/api/tests/registrations.test.ts`
  (9 integration tests: sequential registration numbers, category/event
  consistency, search, immutable registration number, import preview never
  persisting, import commit importing only valid/warning rows and setting
  `duplicateFlag`).

### Tests executed

| Command | Result |
|---|---|
| `pnpm -r lint` | ✅ Passed (`eslint src` clean across all 5 packages). |
| `pnpm -r typecheck` | ✅ Passed (`tsc --noEmit` clean across all 5 packages). |
| `pnpm --workspace-concurrency=1 -r test` | ✅ Passed — 71 tests total: `packages/shared` (6), `apps/api` (61: 10 auth-helper unit + 13 auth/RBAC integration + 15 event/category/volunteer integration + 13 import unit + 9 registration/import integration + 1 health), `apps/web` (1), `apps/worker` (3). |
| `pnpm -r build` | ✅ Succeeded for `apps/api`, `apps/worker` (tsc) and `apps/web` (Vite + PWA service worker generation). |

### Unresolved issues

- Same Docker/Postgres-on-real-infrastructure caveat as prior phases: only
  verified via `embedded-postgres` in this sandbox.
- `InvitationStatus`/`ValidationStatus` literal values are an assumption
  (spec names the columns but not their enum values) — see
  docs/ASSUMPTIONS.md.
- No email/invitation sending yet; `Registration.invitationStatus` exists
  but nothing transitions it out of `NOT_SENT` until Phase 4.

### Next phase

Phase 4 — QR and Invitation System (REQUIREMENTS.md Section 78): secure QR
token generation/storage, PDF invitation generation, email templates, the
`invitation_jobs` queue and worker delivery/retry handling, send/resend API.

## Phase 4 - QR and Invitation System

### What was built

- `packages/database`: `InvitationJobStatus` enum (`PENDING`/`PROCESSING`/
  `SENT`/`FAILED`/`CANCELLED`) and `InvitationJob` model (Section 12.7),
  with an added `nextAttemptAt` column for retry scheduling; relations
  added on `Event`/`Registration`. New migration verified against a fresh
  `embedded-postgres` instance.
- `packages/shared`: pure, unit-tested QR/PDF/email business logic —
  `qr-token.ts` (token generation/hashing/URL building, Section 13),
  `qr-image.ts` (QR PNG rendering via `qrcode`), `invitation-pdf.ts`
  (PDF rendering via `pdf-lib`), `invitation-email.ts` (HTML/text email
  template), `invitation-retry.ts` (Section 21 backoff schedule). Added
  `INVITATION_CC_VOLUNTEER`/`INVITATION_CC_REGISTRATION_MAILBOX` env vars
  (Section 20 CC rules). 23 unit tests in `packages/shared/tests/invitation.test.ts`.
- `apps/worker`: `mailer.ts` (injectable `Mailer`/`SmtpMailer` via
  `nodemailer`) and `invitation-worker.ts` (`processInvitationJobs()` —
  crash-recovery requeue of stale `PROCESSING` jobs, fetch-due-`PENDING`
  batch processing, QR/PDF/email generation, SMTP send, success/failure
  state transitions with backoff retry). 5 integration tests in
  `apps/worker/tests/invitation-worker.test.ts`.
- `apps/api`: `routes/invitations.ts` — `GET /api/v1/events/:eventId/invitations`
  (summary + list), `GET /api/v1/invitation-jobs/:jobId`, `POST
  /api/v1/events/:eventId/invitations/generate`, `POST
  /api/v1/events/:eventId/invitations/send` (optional `registrationIds`
  for "Send Selected" vs. all `NOT_SENT` for "Send All Ready"), `POST
  /api/v1/registrations/:registrationId/invitation/resend` (409 if a job
  is already in-flight), `GET
  /api/v1/registrations/:registrationId/invitation/preview` (ephemeral,
  non-persisted PDF preview, no side effects). All routes require
  `EVENT_MANAGER+`. 12 integration tests in `apps/api/tests/invitations.test.ts`.
- Test infrastructure fix: `packages/database/src/test-db.ts` now forces
  `process.env.TZ = 'UTC'` before starting `embedded-postgres`, fixing a
  latent ~4-hour timestamp skew in every DB-backed integration test caused
  by the sandbox host's local timezone leaking into the test database's
  session default (see docs/ASSUMPTIONS.md).
- `.env.example` updated with `INVITATION_CC_VOLUNTEER`/
  `INVITATION_CC_REGISTRATION_MAILBOX`.

### Tests executed

| Command | Result |
|---|---|
| `packages/shared` unit tests | ✅ 23/23 passed. |
| `apps/worker` unit + integration tests | ✅ 8/8 passed (3 poll + 5 invitation-worker). |
| `apps/api` full test suite | ✅ 73/73 passed (61 prior + 12 new invitation route tests), confirming no regression from the `test-db.ts` timezone fix. |
| `pnpm -r typecheck` / `pnpm -r lint` (per changed package) | ✅ Passed for `packages/database`, `packages/shared`, `apps/worker`, `apps/api`. |

### Unresolved issues

- Same Docker/Postgres-on-real-infrastructure caveat as prior phases.
- Real SMTP delivery has not been exercised against a live mail server —
  only against an injected fake `Mailer` in tests. Should be smoke-tested
  against a real/relay SMTP server during Phase 8 deployment validation.
- The Postgres session-timezone fix is confirmed safe for the official
  `postgres` Docker image (defaults to UTC), but this should be defensively
  hardened with an explicit `TZ=UTC` env var on the `postgres` service in
  `compose.yml` during Phase 8.

### Next phase

Phase 5 — Scanner and Check-In (REQUIREMENTS.md Section 79): camera-based
QR scanning, `checkins` table, transactional check-in logic, partial
family check-in, duplicate check-in handling, manual search fallback.

## Phase 5 - Scanner and Check-In

### What was built

- `packages/database`: `CheckinStatus` enum (`VALID`/`OVERRIDE`/`REVERSED`)
  and `Checkin` model (Section 12.6), with relations on `Event`,
  `Registration`, and `User` (`checkedBy`). New migration verified against
  a fresh `embedded-postgres` instance; `client.ts` exports the new
  enum/model types.
- `apps/api`: `routes/checkins.ts` — `POST
  /api/v1/events/:eventId/qr/validate` (all 8 validation rules from
  Section 14, always HTTP 200 with a `{valid, reason?, message?,
  registration?}` body), `POST /api/v1/events/:eventId/checkins`
  (transactional, row-lock-serialized check-in supporting partial family
  check-in and rejecting over-check-in with 409), `GET
  /api/v1/events/:eventId/checkins/recent`, and `GET
  /api/v1/registrations/:registrationId/checkin-status` (new endpoint
  supporting the manual-search flow). `/checkins/:checkinId/reverse` and
  `/checkins/override` are deliberately deferred to Phase 6. 15
  integration tests in `apps/api/tests/checkins.test.ts`, including a real
  concurrent-check-in race test (4 parallel requests against a 4-seat
  registration).
- `apps/web`: built out the previously-placeholder-only frontend across
  all completed phases (per user's "minimal_functional" directive) —
  `lib/api.ts` (fetch wrapper unwrapping the API envelope), `lib/auth.tsx`
  (`AuthProvider`/`useAuth`/`hasRole`), `routes/LoginPage.tsx`,
  `routes/AppLayout.tsx` (`ProtectedLayout` + nav + `RequireRole`),
  `routes/EventsPage.tsx`, `routes/EventDetailPage.tsx`,
  `routes/RegistrationsPage.tsx` (list/search/manual add/import
  preview+commit), `routes/InvitationsPage.tsx` (summary/generate/send/
  preview), and `routes/ScannerPage.tsx` (camera QR scan via
  `@zxing/browser`, manual search fallback, check-in confirmation with a
  +/- attendee counter, "already fully checked in" state, recent
  check-ins list). Wired all routes into `App.tsx`/`main.tsx`
  (`AuthProvider` + `BrowserRouter` + protected route tree). Added
  `tests/LoginPage.test.tsx`, `tests/ProtectedLayout.test.tsx`, and
  `tests/ScannerPage.test.tsx` (smoke/interaction tests with mocked
  `fetch`).
- Repo-wide: disabled ESLint's `no-undef` rule for TS/TSX files in the
  shared `eslint.config.js` (false positive on the ambient `RequestInit`
  DOM lib type used in `apps/web/src/lib/api.ts`; see
  docs/ASSUMPTIONS.md).

### Tests executed

| Command | Result |
|---|---|
| `apps/api` full test suite | ✅ 88/88 passed (73 prior + 15 new check-in/QR-validate tests). |
| `apps/web` test suite | ✅ 5/5 passed (1 prior `App.test.tsx` + 4 new: `LoginPage` x2, `ProtectedLayout`, `ScannerPage`). |
| `pnpm -r lint` | ✅ Passed across all 5 packages. |
| `pnpm -r typecheck` | ✅ Passed across all 5 packages. |
| `pnpm --workspace-concurrency=1 -r test` | ✅ Passed — 124 tests total (`packages/shared` 23, `apps/api` 88, `apps/web` 5, `apps/worker` 8). |
| `pnpm -r build` | ✅ Succeeded for `apps/api`, `apps/worker` (tsc) and `apps/web` (Vite + PWA service worker generation). |

### Unresolved issues

- Same Docker/Postgres-on-real-infrastructure caveat as prior phases.
- Camera-based QR scanning cannot be exercised in this sandbox/CI (no real
  camera); `ScannerPage`'s scan flow is covered by typecheck/lint/build and
  a jsdom smoke test only, not an end-to-end camera test. Should be
  manually verified on a real device during Phase 8 deployment validation.
- `apps/web`'s production bundle is a single ~700KB JS chunk (Vite warns
  above 500KB); acceptable for now given "minimal_functional" scope, but
  worth revisiting with route-level code splitting (`React.lazy`) before
  production launch.
- Section 28 vs. Section 37 tension (manual search returning full
  registration fields including email at the API layer, minimized only in
  the scanner UI) is a documented assumption, not a structural fix — see
  docs/ASSUMPTIONS.md.

### Next phase

Phase 6 — Supervisor Operations (REQUIREMENTS.md Section 80): check-in
override/reversal APIs (`/checkins/:checkinId/reverse`,
`/checkins/override`), reason capture, audit log entries, SUPERVISOR+
RBAC, and the corresponding frontend (override/reversal UI, audit log
view).

## Phase 6 - Supervisor Operations

### What was built

- `apps/api`: added `POST /api/v1/events/:eventId/checkins/override`
  (SUPERVISOR+, requires a `reason`, creates a `Checkin` row with
  `status=OVERRIDE`, bypasses the remaining-count guard but keeps the same
  row-lock discipline as the normal check-in path) and `POST
  /api/v1/checkins/:checkinId/reverse` (SUPERVISOR+, requires a `reason`,
  sets an existing `Checkin` to `status=REVERSED`, 409 if already
  reversed) to `routes/checkins.ts`. Both record `CHECKIN_OVERRIDE`/
  `CHECKIN_REVERSE` audit log entries via the existing `recordAuditLog()`
  helper. New `overrideCheckinSchema`/`reverseCheckinSchema` in
  `checkins/schemas.ts`. 8 new integration tests in
  `apps/api/tests/checkins.test.ts` (RBAC rejection for volunteers on both
  routes, missing-reason 400s, successful override with audit assertion,
  successful reversal updating calculated attendance + audit assertion,
  409 on double-reversal, 404 on unknown checkin).
- `apps/web`: extended `ScannerPage.tsx` with a supervisor-only "Override &
  Check In" form (shown in the "ALREADY FULLY CHECKED IN" state, requires
  a reason before the button enables) and a per-check-in "Reverse" action
  in the Recent Check-ins list (inline reason input, gated by
  `hasRole(user, 'SUPERVISOR')`). Added a Reverse-action smoke test in
  `tests/ScannerPage.test.tsx`.

### Tests executed

| Command | Result |
|---|---|
| `apps/api` full test suite | ✅ 96/96 passed (88 prior + 8 new override/reverse tests). |
| `apps/web` test suite | ✅ 6/6 passed (4 prior + 1 new supervisor-role scanner test, plus the existing volunteer-role scanner test). |
| `pnpm -r lint` | ✅ Passed across all 5 packages. |
| `pnpm -r typecheck` | ✅ Passed across all 5 packages. |
| `pnpm --workspace-concurrency=1 -r test` | ✅ Passed — 133 tests total (`packages/shared` 23, `apps/api` 96, `apps/web` 6, `apps/worker` 8). |
| `pnpm -r build` | ✅ Succeeded for `apps/api`, `apps/worker` (tsc) and `apps/web` (Vite + PWA service worker generation). |

### Unresolved issues

- Same Docker/Postgres-on-real-infrastructure caveat as prior phases.
- No dedicated audit log viewer UI yet - Section 32 (Phase 7) explicitly
  scopes an "Audit report" export, so a viewer/exporter is planned there
  rather than duplicated in Phase 6.
- `apps/web`'s bundle size warning (see Phase 5) is unchanged; still worth
  revisiting with route-level code splitting before production launch.

### Next phase

Phase 7 — Dashboard and Reports (REQUIREMENTS.md Section 81): dashboard
summary/category/volunteer metrics, arrival timeline, recent activity
(Sections 29-31, 48-49), plus the required CSV/XLSX report exports
(Section 32, including the audit report), and the corresponding frontend
dashboard/report pages.

## Phase 7 - Dashboard and Reports

### What was built

- `apps/api`: extracted `checkins/helpers.ts` (`COUNTING_STATUSES`,
  `sumCheckedIn`, `toScannerView`) out of `routes/checkins.ts` so the new
  dashboard/report routes share the exact same "only VALID/OVERRIDE
  check-ins count" logic. Added `routes/dashboard.ts` (`GET
  /dashboard/summary`, `/categories`, `/volunteers`, `/timeline`,
  `/recent` - Section 48, SUPERVISOR+) and `routes/reports.ts` (`GET
  /reports/attendance`, `/no-show`, `/checkins`, `/invitations` - Section
  49, EVENT_MANAGER+, each supporting `?format=csv|xlsx` via the new
  `reports/export.ts` helper built on the existing `xlsx` package). 13 new
  integration tests across `apps/api/tests/dashboard.test.ts` (6) and
  `apps/api/tests/reports.test.ts` (7), including a summary-matches-
  database-totals assertion and CSV/XLSX byte-level export checks.
- `apps/web`: new `routes/DashboardPage.tsx` (summary cards, category/
  volunteer breakdowns, an hourly arrival timeline bar chart, recent
  check-ins, and CSV/XLSX download links for all four reports), polling
  every 5 seconds per Section 31. Wired into `App.tsx` at
  `/events/:eventId/dashboard`, gated by `RequireRole
  minimumRole="SUPERVISOR"`. Added a "Dashboard" nav link on
  `EventDetailPage`. New smoke test in `tests/DashboardPage.test.tsx`.

### Tests executed

| Command | Result |
|---|---|
| `apps/api` full test suite | ✅ 109/109 passed (96 prior + 13 new dashboard/report tests). |
| `apps/web` test suite | ✅ 7/7 passed (6 prior + 1 new DashboardPage smoke test). |
| `pnpm -r lint` | ✅ Passed across all 5 packages. |
| `pnpm -r typecheck` | ✅ Passed across all 5 packages. |
| `pnpm --workspace-concurrency=1 -r test` | ✅ Passed — 147 tests total (`packages/shared` 23, `apps/api` 109, `apps/web` 7, `apps/worker` 8). |
| `pnpm -r build` | ✅ Succeeded for `apps/api`, `apps/worker` (tsc) and `apps/web` (Vite + PWA service worker generation). |

### Unresolved issues

- Same Docker/Postgres-on-real-infrastructure caveat as prior phases.
- Section 32's five extra report *types* without a literal Section 49 API
  route (complete registration list, partially-checked-in report,
  volunteer assignment report, failed-invitation report, audit report)
  are not implemented as separate endpoints - see docs/ASSUMPTIONS.md. The
  attendance report already includes a `status` column distinguishing
  fully/partially/not-arrived, and the invitations report already
  surfaces failed jobs, so most of that information is still reachable,
  just not as dedicated named reports.
- The dashboard's "By Volunteer" breakdown has no denominator (no
  assignment model exists in the schema - see docs/ASSUMPTIONS.md),
  unlike Section 30's illustrative "28/32" example.
- `apps/web`'s bundle size warning (see Phase 5) is unchanged; still worth
  revisiting with route-level code splitting before production launch.

### Next phase

Phase 9 — Event Simulation (REQUIREMENTS.md Section 83): seeded load/attendee
simulation testing.

## Phase 8 - Production Hardening

Implemented per REQUIREMENTS.md Section 82:

- **Security headers**: registered `@fastify/helmet` globally on the API
  (conservative defaults; HSTS deliberately left off at this layer - see
  ASSUMPTIONS.md). `docker/nginx.conf` already carried `X-Content-Type-
  Options`/`X-Frame-Options`/`Referrer-Policy` from Phase 0 and needed no
  changes.
- **Rate limiting**: already in place since Phase 0/1 (`@fastify/rate-
  limit`, global default 100/min plus a tighter per-route login limiter) -
  reviewed and confirmed adequate, no changes needed.
- **Health endpoints**: added `GET /api/ready` (checks DB connectivity via
  `SELECT 1` and required config presence; returns 503 with `NOT_READY` on
  failure) alongside the existing `GET /api/health` (process-liveness only).
- **Docker health checks**: `compose.yml`'s `api` healthcheck now targets
  `/api/ready` instead of `/api/health` (so container-marked-healthy
  actually means "safe to route traffic to"); added a process-liveness
  healthcheck for `worker` (which has no HTTP listener, so it checks the
  Node process is running via `ps`); `postgres`'s `pg_isready` healthcheck
  and `TZ=UTC` were confirmed/added.
- **Production Nginx**: reviewed `docker/nginx.conf` against Section 55 -
  already had SPA fallback, static asset caching, gzip, `/api` proxying, and
  security headers from Phase 0; no changes were needed.
- **Structured logs**: replaced Fastify's default access log
  (`disableRequestLogging: true`) with a custom `onResponse` hook emitting
  exactly the Section 61 field set (`requestId`/`route`/`httpStatus`/
  `userId`/`durationMs`/`errorType`) and nothing else - never request/
  response bodies, so credentials/tokens can't leak into logs by
  construction.
- **Backup script**: `scripts/backup.sh` now runs `pg_dump | gzip` against
  the `postgres` compose service, timestamps the output, and rotates it
  through a Grandfather-Father-Son scheme (7 daily / 4 weekly / 6 monthly)
  under `$BACKUP_DIR/database/`; also snapshots `.env` + Compose/Nginx
  config into `$BACKUP_DIR/config/`. Exits non-zero and logs on any
  failure.
- **Restore documentation/script**: `scripts/restore.sh` drops/recreates
  the public schema and replays a given dump; requires typing the database
  name to confirm when run interactively (`--yes` skips this for scripted
  drills). Full usage documented in `docs/SYNOLOGY_DEPLOYMENT.md`.
- **Synology deployment documentation**: new `docs/SYNOLOGY_DEPLOYMENT.md`
  covering prerequisites, `.env` setup, `docker compose up -d --build`,
  DSM reverse proxy configuration (Section 56), Let's Encrypt HTTPS
  (Section 57), router/firewall guidance (Section 58), health-check
  verification (Section 62), and the backup/restore workflow (Section 59).

### New/changed files

- `apps/api/src/app.ts`: `@fastify/helmet` registration, `/api/ready`
  endpoint, structured `onResponse` logging hook, `errorType` request
  decoration set by the existing error handler.
- `apps/api/tests/health.test.ts`: unchanged in scope (still `/api/health`
  only).
- `apps/api/tests/ready.test.ts`: new - `/api/ready` success-path test using
  a real embedded test database (kept in its own file; see ASSUMPTIONS.md
  for why it can't share a file with another `buildApp()` call).
- `compose.yml`: `postgres` gets an explicit `TZ=UTC`; `api` healthcheck now
  targets `/api/ready`; `worker` gets a process-liveness healthcheck.
- `scripts/backup.sh` / `scripts/restore.sh`: full implementations
  (previously Phase-8 placeholders that exited non-zero).
- `docs/SYNOLOGY_DEPLOYMENT.md`: new.
- `README.md`: status line, migrations/bootstrap-admin, and backup/restore
  sections updated to reflect what's now actually implemented.
- `.env.example`: added `BACKUP_DIR`.
- `apps/api/package.json`: added `@fastify/helmet` dependency.

### Tests executed

| Command | Result |
|---|---|
| `apps/api` full test suite | ✅ 110/110 passed (109 prior + 1 new `/api/ready` test). |
| `pnpm -r lint` | ✅ Passed across all 5 packages. |
| `pnpm -r typecheck` | ✅ Passed across all 5 packages. |
| `pnpm -r build` | ✅ Succeeded for `apps/api`, `apps/worker` (tsc) and `apps/web` (Vite + PWA service worker generation). |
| `pnpm test` (full monorepo) | ✅ 148 tests total (`packages/shared` 23, `apps/api` 110, `apps/web` 7, `apps/worker` 8). |

### Unresolved issues

- Event Snapshot (Section 60) is not implemented as a dedicated feature -
  documented as a known gap in `docs/SYNOLOGY_DEPLOYMENT.md` since it's not
  in Phase 8's literal implement/acceptance-criteria list.
- Compose/health-check/backup-restore behavior has only been verified with
  the embedded-Postgres test harness and manual script syntax checks in
  this sandbox (no Docker daemon available here) - a real `docker compose
  up -d --build` run should be the first smoke test performed on the actual
  Synology NAS before relying on this in production.
- `apps/web`'s bundle size warning (see Phase 5) is unchanged.

### Next phase

Phase 9 — Event Simulation (REQUIREMENTS.md Section 83): seeded load/
attendee simulation testing.

## Phase 9 - Event Simulation

Implemented per REQUIREMENTS.md Section 83 as a single integration test
file, `apps/api/tests/event-simulation.test.ts`, against a real (embedded)
database - not a standalone script - since its whole purpose is repeatable,
CI-checkable verification of the five acceptance criteria, which fits the
existing integration-test infrastructure (`startTestDatabase()`,
`buildApp()`) far better than an ad hoc one-off script.

- **Seed**: 1 event, 4 categories (Participant/Volunteer/Satsang/Guest), 10
  volunteer users ("10 volunteers"), 1,000 registrations bulk-inserted via
  `createManyAndReturn`, `registeredCount` cycling across 1/2/4 ("partial
  family attendance" - single attendee, family of 2, family of 4), each
  with a real QR token (`generateQrToken`/`hashQrToken`, same as
  production).
- **Concurrent scans**: 300 distinct registrations checked in concurrently
  (via the real `/qr/validate` → `/checkins` flow) across the 10 volunteer
  logins and 10 `counterName` values ("10 counters") - all 201, no errors.
- **Repeated QR scans**: for 100 more registrations, 3 concurrent
  full-attendee-count check-in requests each (simulating the same badge
  scanned by 3 volunteers at once) - exactly 1 succeeds and 2 are cleanly
  rejected as `OVER_CHECKIN` per registration, verified both from the HTTP
  responses and by re-aggregating the `checkins` table.
- **Bulk email queue**: `POST /invitations/generate` against all 1,000
  registrations at once - exactly 1,000 `InvitationJob` rows created (no
  duplicates), all registrations transition to `PENDING`.
- **Dashboard polling**: 15 concurrent `GET /dashboard/summary` requests
  fired alongside a fresh batch of 200 concurrent check-ins - all succeed,
  and the dashboard's `totalArrived` is re-verified to exactly match a
  fresh aggregate query against the `checkins` table afterward.
- **Acceptance criteria** (Section 83), verified explicitly: no duplicate
  registration numbers (checked via a `GROUP BY ... HAVING COUNT(*) > 1`
  raw query against the live table), no over-check-in for any registration
  in the whole simulated event, no 500s/deadlocks across any of the ~2,000
  simulated requests, and every error response carries a clear,
  well-formed `error.code` (`OVER_CHECKIN`) - Section 61's structured
  logging (Phase 8) is what makes any *unexpected* error clearly
  attributable in a real deployment, so log output itself isn't
  re-asserted here.

### New/changed files

- `apps/api/tests/event-simulation.test.ts`: new - the whole of Phase 9.

### Tests executed

| Command | Result |
|---|---|
| `apps/api` full test suite | ✅ 116/116 passed (110 prior + 6 new event-simulation tests). |
| `pnpm -r lint` | ✅ Passed across all 5 packages. |
| `pnpm -r typecheck` | ✅ Passed across all 5 packages. |
| `pnpm -r build` | ✅ Succeeded for `apps/api`, `apps/worker` (tsc) and `apps/web` (Vite + PWA service worker generation). |

### Unresolved issues

- This exercises the full 1,000-registration/10-volunteer/10-counter scale
  Section 83 asks for, but the *concurrency* depth in the "concurrent
  scans"/"dashboard polling" tests (a few hundred simultaneous requests) is
  a representative slice rather than a literal full-1,000-at-once burst,
  purely for CI runtime - the correctness mechanism under test (the
  `FOR UPDATE` row lock plus `COUNTING_STATUSES`-filtered aggregation) is
  scale-independent, so this doesn't weaken the acceptance-criteria
  verification.
- As with Phase 8, all of this has only been run against the
  embedded-Postgres test harness in this sandbox, not a real multi-core
  Docker/Postgres deployment - real-world latency/throughput
  characteristics should still be spot-checked on the actual Synology NAS
  before a live event.

### Next phase

All 10 phases (0-9) from REQUIREMENTS.md are now implemented. Remaining
future work is limited to the documented gaps listed across this file and
`docs/ASSUMPTIONS.md` (e.g. Event Snapshot, the extra Section 32 report
types, `apps/web`'s bundle-size warning).

## Phase 10 - Post-Launch Production Feedback — COMPLETE

After the app went live on the Synology NAS, real end-to-end usage
(sending invitations, registering, checking in) surfaced a round of bug
reports and feature requests. All of the following were implemented,
tested against the real embedded-Postgres harness, and verified with a
full `pnpm -r lint` / `pnpm -r typecheck` / `pnpm -r test` / `pnpm -r
build` pass.

### Bug fixes

- **PWA service worker hijacking API links**: `vite-plugin-pwa`'s
  `navigateFallback` was catching clicks on `/api/...` links (Reports
  CSV/XLSX download links, invite-attachment "View"/"Preview" links) and
  serving the cached app shell instead of letting the browser navigate to
  the API route. Fixed with `workbox.navigateFallbackDenylist:
  [/^\/api\//]` in `apps/web/vite.config.ts`. Requires an unregister of
  the old service worker / hard browser refresh to take effect for
  already-installed clients.
- **QR scanner not checking in**: fixed a bug in the scanner's check-in
  flow (`apps/web/src/routes/ScannerPage.tsx`) that prevented successful
  scans from being recorded.
- **Docker build using an unsupported pnpm/Node combination**: `pnpm
  prisma:deploy` inside the `api`/`worker` containers was failing with
  `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` because Corepack was
  downloading a pnpm release that requires Node >= 22.13 while the image
  runs Node 20. Resolved by pinning the pnpm version used inside the
  Docker images.

### New features

- **Mobile number with country code** and an **optional linked
  volunteer** field added to the registration form and API.
- **Event-level and category-level invite PDF attachments**: an admin
  can upload a PDF when creating/editing an event (the "common"
  template), and optionally a more specific PDF per category. When an
  invitation email is sent, the category's own template is used if set,
  otherwise the event's common template, otherwise no attachment.
  Storage is as `bytea` columns on `events`/`categories` (avoids needing
  a shared file volume between the `api` and `worker` containers).
- **CC the linked volunteer on invitation emails**, gated behind the
  `INVITATION_CC_VOLUNTEER` env flag (default `false`) plus a
  `INVITATION_CC_REGISTRATION_MAILBOX` fallback mailbox option — both
  documented in `.env.example` and `docs/ASSUMPTIONS.md`.
- **Individual QR code per registered guest**: the ticket PDF now
  renders one page per guest for `registeredCount > 1` (e.g. 4 pax → 4
  pages, each labeled "Guest X of N"), reusing the same underlying QR
  token per page. This works unchanged with the existing partial
  check-in logic (`apps/api/src/routes/checkins.ts` already tracks a
  running `attendeeCount` per registration and rejects over-check-in),
  so no backend/schema changes were required. Trade-off accepted by the
  customer: all N pages share one QR image/token rather than N
  cryptographically distinct one-time tokens.
- **Volunteer hard-delete**: `DELETE
  /api/v1/volunteers/:volunteerId?hard=true` permanently removes a
  volunteer record, alongside the existing soft-deactivate default.
- **Downloadable Excel bulk-registration import template**: `GET
  /api/v1/events/:eventId/import/template` returns a `.xlsx` with the
  expected headers, one filled example row, and one blank row.
- **"Back to Event" navigation links** added to the
  Registrations/Invitations/Scanner/Dashboard pages.
- A PDF **user testing guide** was produced for manual QA
  (`docs/Dharma_Events_User_Testing_Guide.pdf`).

### Known limitation (explicitly deferred at customer's request)

- **Email bounce tracking**: immediate SMTP rejections (e.g. malformed
  address) already surface as `FAILED` in the Invitations screen. A
  fake-but-well-formed or since-closed mailbox that is *accepted* by the
  receiving mail server and only bounces asynchronously later is **not**
  tracked — that would require either bounce-mailbox polling or a
  pre-send address-verification service, both out of scope for now.

### New/changed files (representative, not exhaustive)

- `apps/web/vite.config.ts`, `apps/web/src/routes/ScannerPage.tsx`
- `apps/api/src/routes/{categories,events,invitations,volunteers,import}.ts`
- `apps/worker/src/invitation-worker.ts`
- `packages/shared/src/invitation-pdf.ts`
- `packages/database/prisma/schema.prisma` +
  `prisma/migrations/20260902060000_event_invite_attachment/`,
  `prisma/migrations/20260902190000_category_invite_attachment/`

### Tests executed

| Command | Result |
|---|---|
| `apps/api` full test suite | ✅ 127/127 passed. |
| `apps/worker` full test suite | ✅ 10/10 passed. |
| `apps/web` full test suite | ✅ 7/7 passed. |
| `pnpm -r lint` | ✅ Passed across all packages. |
| `pnpm -r typecheck` | ✅ Passed across all packages. |
| `pnpm -r build` | ✅ Succeeded for all apps. |

### Deployment notes

Because this phase changed the database schema, the API, the worker, and
the web app, a deploy requires: `docker compose build api worker web` →
`docker compose run --rm api sh -c "cd /repo/packages/database &&
./node_modules/.bin/prisma migrate deploy"` → `docker compose up -d api
worker web`, followed by a hard refresh (or service-worker unregister) in
the browser for any already-installed PWA client. See
`docs/SYNOLOGY_DEPLOYMENT.md` for full details.

## Phase 11 - UI Modernization Phase 0 + Phase 1 + Phase 2 — IN PROGRESS

Governed by `DHARMA_EVENTS_UI_MODERNIZATION.md` (added to the repo root
this phase). Explicit non-negotiable: no API contract, database schema,
QR payload, email workflow, calculation, or report content changes.

### Phase 0 - Regression safety net (complete)

- Discovered `e2e/` had been scaffolded in an earlier session but was
  never added to `pnpm-workspace.yaml`, so Playwright was never actually
  installed or runnable. Fixed.
- Built a real-stack E2E harness (`e2e/global-setup.ts`): embedded
  Postgres + the real API server + `bootstrap:admin` + a seeded fixture
  event/category, matching Vite's existing dev proxy target so no
  frontend config changes were needed. The worker is intentionally not
  started (invitation "send" only queues jobs; PDF/SMTP already has
  dedicated Vitest coverage with a `FakeMailer` per the spec's "never
  send automated regression emails" rule).
- Added specs for Section 13's critical paths: `auth`, `events`,
  `registrations`, `invitations`, `checkin`, `reports` (plus the
  pre-existing `smoke`). 26/26 passing.
- Notable finding: the documented "logout leaves protected content
  visible" issue did not reproduce against this dev harness (no service
  worker running under Vite dev, and the reactive redirect via React
  Query's cache update happens fast enough here) - most likely a
  production PWA/back-forward-cache interaction rather than a missing
  `navigate()` call. Flagged for the Phase 2 fix to address both.

### Phase 1 - Low-risk UI modernization (complete)

- Shared design system (`apps/web/src/components/ui.tsx`):
  `LoadingSkeleton`, `EmptyState`, `ErrorState` (with retry),
  `StatusBadge`, `SummaryCard`, `Modal`.
- Persistent event-scoped navigation (`components/EventNav.tsx`): tab
  strip on desktop, fixed icon bottom-bar on mobile/tablet
  (Overview/Registrations/Invitations/Check-in/Dashboard), replacing
  each page's own "back to event" link. Top bar now shows the current
  event's name/friendly date/status.
- Friendly dates (`lib/format.ts`) replace raw ISO strings across
  Events, Dashboard, Scanner.
- Events: "+ New Event" opens a modal (previously an always-visible
  inline form); adds client-side search; responsive table->card layout.
- Registrations/Invitations: responsive table->card layout, status
  badges, per-page loading/error states, invitation actions show
  in-progress labels and readable error text.
- Scanner: larger SCAN QR / CHECK IN touch targets, camera-permission
  guidance text.
- Login: show/hide password toggle.
- Global CSS: accent color token, focus-visible ring, prefers-reduced-
  motion support, 44px-minimum touch targets, 16px input font (prevents
  iOS auto-zoom), responsive table CSS pattern, skeleton/modal styles.

Deferred to Phase 2 (per the spec's own phase boundaries): confirmation
dialogs before Send All Ready/Resend, the logout navigation/bfcache fix,
a registration detail view, report cards, a guided import stepper.

### Tests executed

| Command | Result |
|---|---|
| `pnpm --filter @dharma-events/web lint` / `typecheck` | ✅ Passed. |
| `pnpm -r lint` / `pnpm -r typecheck` | ✅ Passed across all packages. |
| `pnpm --filter @dharma-events/web build` | ✅ Succeeded (production bundle + PWA precache). |
| `e2e` full Playwright suite | ✅ 26/26 passed. |
| Manual screenshot review at 375×812, 768×1024, 1440×900 | ✅ No horizontal overflow; nav/tabs behave correctly at each breakpoint. |

### Phase 2 - Safety and workflow clarity (complete)

Strictly no API/schema changes - every feature below reuses an existing
endpoint (or purely-client data already returned by one).

- **Logout fix** (`lib/auth.tsx`): `logoutMutation.onSuccess` now calls
  `navigate('/login', { replace: true })` in addition to clearing the
  query cache, and a new `pageshow` listener invalidates the
  `currentUser` query whenever a page is restored from the browser's
  back-forward cache (`event.persisted`). Phase 0 testing showed the
  documented bug didn't reproduce against the dev harness (no service
  worker under Vite dev, cache invalidation redirects fast enough there)
  - the working theory is a production PWA/bfcache interaction, so this
    phase covers both the explicit navigation *and* the bfcache guard.
- **Confirmation dialogs** (new shared `ConfirmDialog` in
  `components/ui.tsx`, built on the existing `Modal`): wired into
  Invitations' "Send All Ready" (shows the ready count) and per-row
  "Resend", and replaces the old `window.confirm` on the volunteer
  "Delete" button in Event Detail.
- **Registration detail view** (new read-only
  `components/RegistrationDetailModal.tsx`, opened via a "View" button
  per row on Registrations): combines `GET
  /api/v1/registrations/:id` and the scanner's `GET
  /api/v1/registrations/:id/checkin-status` endpoint for arrival counts.
  Deliberately no edit form - registration edit/cancel/delete APIs are
  explicitly Phase 3 scope per the spec.
- **Invitation preview improvements**: the Invitations table now shows a
  "📎 Attachment" indicator next to "Preview PDF" when the registration's
  category or the event itself has an invite attachment configured,
  using the `inviteAttachmentFilename` field already returned by the
  existing categories/event endpoints (no new API).
- **Guided import stepper** (Registrations page): the existing
  Download-template -> select file -> preview -> commit import flow is
  now presented behind a 4-step numbered stepper UI; the underlying
  fetch/preview/commit logic is unchanged.
- **Report cards** (Dashboard): the plain link list of reports is now a
  card grid with a title, one-line description, and CSV/XLSX buttons per
  report.
- New CSS: `.detail-row`, `.report-grid`/`.report-card`, `.stepper`.

### Tests executed (Phase 2)

| Command | Result |
|---|---|
| `pnpm --filter @dharma-events/web lint` / `typecheck` | ✅ Passed. |
| `pnpm --filter @dharma-events/web build` | ✅ Succeeded. |
| `e2e` full Playwright suite (updated `invitations.spec.ts` for the new
  Send All Ready confirmation step) | ✅ 26/26 passed. |
| Manual screenshot review at 375×812, 768×1024, 1440×900 | ✅ No layout regressions on Registrations, Invitations, Dashboard, Event Detail. |

### Phase 2 follow-up fixes (post-release, same phase)

- **Modal focus-stealing bug**: the shared `Modal` component's
  focus-on-open `useEffect` had `onClose` in its dependency array. Since
  callers frequently pass an inline arrow function for `onClose` (a new
  function identity on every parent render), the effect re-ran on every
  keystroke in any form inside a modal (first observed in Events' "Create
  Event" dialog: typing a second character required re-clicking the
  field). Fixed by splitting into two effects - the initial-focus call
  now only runs once on mount (`[]`), and the Escape-key listener (safe
  to re-register) keeps `onClose` in its own dependency array. Covered by
  a new regression test in `e2e/tests/events.spec.ts` that types a full
  string via `pressSequentially` and asserts the complete value lands
  (confirmed this test fails against the old code, reproducing exactly
  the reported symptom, and passes against the fix).
- **Invitation attachment order flipped**: per explicit customer request,
  the merged PDF attachment now places the uploaded invite attachment
  (flyer/brochure/formal letter) pages *first*, followed by the generated
  ticket page(s) with the QR code - previously the ticket came first and
  the attachment was appended after. Changed in both the real send path
  (`apps/worker/src/invitation-worker.ts`) and the admin "Preview PDF"
  endpoint (`apps/api/src/routes/invitations.ts`) so the preview always
  matches what's actually emailed. `apps/worker/tests/invitation-
  worker.test.ts` was strengthened to assert page order (not just page
  count) - attachment pages' dimensions come first, ticket pages' after.

| Command | Result |
|---|---|
| `pnpm --filter @dharma-events/worker test` | ✅ 10/10 passed (including the strengthened order-assertion test). |
| `pnpm --filter @dharma-events/api lint` / `typecheck` / `build` | ✅ Passed. |
| `pnpm --filter @dharma-events/web lint` / `typecheck` / `build` | ✅ Passed. |
| `pnpm --filter @dharma-events/worker build` | ✅ Passed. |
| `e2e` full Playwright suite (added a modal-focus regression test) | ✅ 27/27 passed. |

## Phase 3 - Manage Events (admin cleanup) — COMPLETE

Per DHARMA_EVENTS_UI_MODERNIZATION.md, Phase 3 features each require
separate approval. The customer approved one specific item: an ADMIN-only
screen to permanently delete test/duplicate events before real production
use (the other 7 listed Phase 3 items - registration edit/cancel/delete,
offline check-in sync, bounce tracking, a more granular role model, audit
UI, WhatsApp delivery, self-service public registration - remain
unapproved/out of scope for now).

### What changed

- **`DELETE /api/v1/events/:eventId?hard=true`**: the existing archive
  endpoint (soft-delete, sets `status: 'ARCHIVED'`, EVENT_MANAGER+) now
  also supports a `hard=true` query param, gated at ADMIN via
  `roleSatisfies()` (403 for anyone below ADMIN). When hard, the event
  row is actually deleted (`prisma.event.delete`); the schema already had
  `onDelete: Cascade` on Category/Volunteer/Registration/CheckIn/
  InvitationJob -> Event and `onDelete: SetNull` on `AuditLog.eventId`, so
  no migration was needed for a clean cascade. An `EVENT_DELETE` audit
  log entry is written (`eventId: null` since the event is gone,
  `metadata` captures the eventCode/eventName for traceability).
- **New `ManageEventsPage.tsx`** (`/admin/events`, ADMIN-only via
  `RequireRole minimumRole="ADMIN"`): lists every event (including
  archived) with a "Delete permanently" button per row. Clicking opens a
  modal that requires typing the exact event code before the confirm
  button enables - deliberately stricter than the standard
  `ConfirmDialog`, given this action is irreversible.
  A "Manage Events" nav link (ADMIN-only) was added to the top app nav in
  `AppLayout.tsx`.

### Tests executed (Phase 3)

| Command | Result |
|---|---|
| `pnpm --filter @dharma-events/api typecheck` | ✅ Passed. |
| `pnpm --filter @dharma-events/web lint` / `typecheck` / `build` | ✅ Passed. |
| `e2e` full Playwright suite (added `e2e/tests/manage-events.spec.ts`: nav
  visibility/listing, and delete-disabled-until-exact-code-match, then
  permanent delete verified via UI and a direct API re-fetch) | ✅ 29/29 passed. |

### Phase 3 follow-up fix: bulk import no longer blocks on category

- **Bug**: the bulk registration import (spreadsheet upload) rejected any
  row with a blank or unrecognized "Category" value as a hard error,
  which meant an event with no categories pre-created (or a spreadsheet
  using category names that didn't exactly match) couldn't be imported
  at all - even though the point of import is often to bring in data
  before manually curating categories.
- **Fix**: category is no longer a hard-error condition in
  `apps/api/src/registrations/import.ts`'s `validateRow`. An unrecognized
  category name now produces a warning ("New category "X" will be
  created.") instead of an error, and a blank category produces a
  warning ("No category specified - will be assigned to
  "Uncategorized"."). Both cases still import the row. On commit
  (`apps/api/src/registrations/import-service.ts`), any category name
  present in the file that doesn't already exist for the event is
  created automatically inside the same transaction as the import, and
  every row with a blank category falls back to a shared "Uncategorized"
  category (created on demand, once per event). Preview never persists
  anything, matching the existing "no writes during preview" rule.

| Command | Result |
|---|---|
| `pnpm --filter @dharma-events/api test` | ✅ 128/128 passed (updated 2
  existing tests' expectations plus a new test asserting an unrecognized
  category is auto-created and a blank one falls back to
  "Uncategorized"). |
| `pnpm --filter @dharma-events/api lint` / `typecheck` / `build` | ✅ Passed. |
| `e2e` full Playwright suite | ✅ 29/29 passed. |

## Phase 3 - Restricted VOLUNTEER role ("check-in + dashboard only") — COMPLETE

Separately approved: event-day check-in staff logging in as VOLUNTEER
should only see Check-in (and Dashboard, if also granted SUPERVISOR) -
not Registrations, Invitations, Overview, or Manage Events. VOLUNTEER
already couldn't reach Invitations at the API layer (EVENT_MANAGER+
only); this closes the remaining gaps.

### What changed

- **Backend**: `GET /api/v1/events/:eventId/registrations` (full
  registrant list) and `GET /api/v1/registrations/:registrationId`
  (single registration detail) are now `SUPERVISOR+` instead of
  `VOLUNTEER+` (`apps/api/src/routes/registrations.ts`). Check-in itself
  never needed these - the scanner already uses its own `/search` and
  `/checkin-status` endpoints (both unchanged, still VOLUNTEER+).
- **Frontend nav** (`apps/web/src/components/EventNav.tsx`): each event
  tab now declares a `minimumRole`; Overview and Registrations require
  SUPERVISOR+, Invitations requires EVENT_MANAGER+ (matching the
  backend), Dashboard stays SUPERVISOR+, and Check-in has no
  restriction. A plain VOLUNTEER now sees only the Check-in tab.
- **Routing** (`apps/web/src/App.tsx`): `/events/:eventId/registrations`
  and `/events/:eventId/invitations` are now wrapped in `RequireRole`
  (SUPERVISOR and EVENT_MANAGER respectively), so a VOLUNTEER hitting
  those URLs directly (bookmark, back button) sees the existing "You do
  not have permission" message instead of a broken/partial page.
- **Overview redirect** (`apps/web/src/routes/EventDetailPage.tsx`): since
  VOLUNTEER no longer has an Overview tab to click, visiting
  `/events/:eventId` directly (e.g. from the Events list link) now
  redirects a below-SUPERVISOR user straight to `/events/:eventId/scanner`
  instead of showing a permission message for a page they'd otherwise
  have no way to reach.

### Tests executed (Phase 3 - restricted role)

| Command | Result |
|---|---|
| `pnpm --filter @dharma-events/api test` | ✅ 129/129 passed (updated
  the registrations-list test to use an admin cookie, added a new test
  asserting a volunteer gets 403 on the list/detail endpoints). |
| `pnpm --filter @dharma-events/api` / `web` lint, typecheck, build | ✅ Passed. |
| `e2e` full Playwright suite (added
  `e2e/tests/restricted-checkin-role.spec.ts`: nav shows only Check-in,
  direct Overview URL redirects to Check-in, Registrations/Invitations
  URLs show the permission message, and the backend list endpoint
  returns 403 for this role) | ✅ 33/33 passed. |

