# Synology Deployment Guide

This guide covers deploying Dharma Events to a Synology NAS running DSM 7+
with Container Manager (Docker), for the public URL
`https://events.sansmi.org` (REQUIREMENTS.md Sections 54-63).

## 1. Prerequisites

- A Synology NAS with **Container Manager** (DSM 7.2+) or the older
  **Docker** package installed.
- SSH access to the NAS enabled (Control Panel → Terminal & SNMP), or use
  Container Manager's project UI - this guide uses the SSH/CLI workflow
  since it maps directly onto `docker compose`.
- A domain name (`events.sansmi.org`) pointed at your public IP (or handled
  via DDNS if using Synology's own domain).
- Node.js/pnpm are **not** required on the NAS itself - everything runs
  inside the containers built from the repository's Dockerfiles.

## 2. Get the code onto the NAS

```bash
# Over SSH, in a persistent shared folder, e.g. /volume1/docker/
cd /volume1/docker
git clone <your-repository-url> dharma-events
cd dharma-events
```

If you don't run git on the NAS, copy the repository via File Station /
`rsync` instead - just ensure the full working tree (including `docker/`,
`compose.yml`, `packages/`, `apps/`) is present.

## 3. Configure environment variables

```bash
cp .env.example .env
vi .env   # or edit via File Station
```

At minimum, set for production:

- `POSTGRES_PASSWORD` - a strong, unique password.
- `SESSION_SECRET` - a random 32+ character value (e.g. `openssl rand -hex 32`).
- `PUBLIC_URL=https://events.sansmi.org`
- `NODE_ENV=production`
- SMTP settings (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USERNAME`/`SMTP_PASSWORD`/
  `SMTP_FROM_EMAIL`) for invitation email delivery.
- `BACKUP_DIR` - an absolute path on persistent storage, e.g.
  `/volume1/docker/dharma-events/backups`.

`.env` contains secrets - it is excluded from backups' plaintext exposure by
`chmod 600` in `scripts/backup.sh`'s config bundle, and must never be
committed to source control (already covered by `.gitignore`).

## 4. Start the application

```bash
docker compose up -d --build
```

This builds and starts four containers on an internal-only Docker network
(`postgres`, `api`, `worker`, `web`), per Section 54:

- `postgres` has **no published port** - it is unreachable from outside the
  Docker network, including from the NAS's other services.
- `web` (Nginx, serving the built React app and proxying `/api` to `api`) is
  published on **host port 8088 only** - not yet the internet.

Verify everything is healthy:

```bash
docker compose ps                 # all services should show "healthy"
curl http://localhost:8088/api/health
curl http://localhost:8088/api/ready
```

**Run database migrations** (required before first use - `/api/ready`
only checks that Postgres is reachable, not that the schema exists; the
`api`/`worker` containers deliberately do **not** run migrations
automatically on startup, so this is a required manual step every time a
release adds new migrations):

```bash
docker compose exec api sh -c "cd /repo/packages/database && node_modules/.bin/prisma migrate deploy"
```

Then bootstrap the first admin user by running the compiled CLI inside the
already-running `api` container:

```bash
docker compose exec api env \
  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=change_me ADMIN_NAME="Admin" \
  node dist/cli/bootstrap-admin.js
```

Idempotent - safe to re-run; exits without changes if `ADMIN_EMAIL` already
exists.

## 4b. Configure DNS

Before requesting a Let's Encrypt certificate (Step 6) or creating the
reverse proxy rule (Step 5), point `events.sansmi.org` at your network:

- If you have a static public IP: create an `A` record for
  `events.sansmi.org` pointing at it.
- If your ISP assigns a dynamic IP: use Synology's DDNS service (**Control
  Panel → External Access → DDNS**) or a third-party DDNS provider, and
  create a `CNAME` for `events.sansmi.org` pointing at the DDNS hostname.

DNS must resolve correctly (`dig events.sansmi.org` or `nslookup`) before
Let's Encrypt's domain validation in Step 6 will succeed.

## 5. Synology Reverse Proxy (HTTPS termination)

Per Section 56, DSM's reverse proxy sits in front of the `web` container and
terminates HTTPS:

1. **DSM Control Panel → Login Portal → Advanced → Reverse Proxy → Create.**
2. **Source:**
   - Protocol: `HTTPS`
   - Hostname: `events.sansmi.org`
   - Port: `443`
   - Enable HSTS if you want the header applied at this layer (recommended,
     since the `web` container itself does not set HSTS - see Section 8).
3. **Destination:**
   - Protocol: `HTTP`
   - Hostname: `localhost`
   - Port: `8088`
4. Under the rule's **Custom Header** tab, enable the `WebSocket` preset if
   available (harmless even though this app doesn't use WebSockets - Section
   31 explicitly uses polling instead).
5. Save.

**Never** create a reverse proxy rule (or open a firewall/router port)
pointing directly at the `api` container's port - the only public entry
point is the `web` container via this reverse proxy rule.

## 6. HTTPS certificate (Let's Encrypt)

Per Section 57, HTTPS is mandatory (secure cookies, camera access, PWA
service workers, and encryption in transit all require it):

1. **DSM Control Panel → Security → Certificate → Add → Let's Encrypt.**
2. Domain: `events.sansmi.org`. Complete domain validation (DSM handles the
   ACME challenge automatically if port 80 is reachable - see below).
3. Assign the new certificate to the reverse proxy rule created in Step 5
   (Control Panel → Security → Certificate → Configure → select the
   `events.sansmi.org` service).
4. DSM auto-renews Let's Encrypt certificates; no further action needed.

## 7. Router / Firewall configuration

Per Section 58, forward/expose as little as possible:

| Port | Direction | Purpose |
| --- | --- | --- |
| 443/TCP | Router → NAS | HTTPS (required, permanent) |
| 80/TCP | Router → NAS | Only if needed for Let's Encrypt HTTP-01 validation/redirect; can be closed again afterwards if you switch to DNS validation |

**Never** forward or otherwise expose from the internet:

- PostgreSQL (5432) - it isn't published to the host at all, so this is
  already impossible via Docker, but also block it at the router regardless.
- The `api` container's port - it's internal-network-only in `compose.yml`.
- The DSM administration port (5000/5001, or your customized port).
- Any worker port (the worker has no listener at all).

Additionally, in DSM's own **Control Panel → Security → Firewall**, restrict
inbound connections to the ports actually needed (443, and 80 only while
provisioning certificates), and enable **Auto Block** for repeated failed
login attempts against DSM itself.

## 8. Logging

The API emits one structured JSON log line per request (Section 61) with
`requestId`, `route`, `httpStatus`, `userId`, `durationMs`, and `errorType`.
Passwords, SMTP credentials, raw QR tokens, and full auth tokens are never
logged - only cookie-based session identifiers are used, and identifiers
sent by clients are hashed before storage/lookup where applicable (QR
tokens; see `apps/api/src/checkins/`).

View live logs with:

```bash
docker compose logs -f api
docker compose logs -f worker
```

## 9. Monitoring / Health Checks

- `GET /api/health` - confirms the API process is running.
- `GET /api/ready` - confirms the database is reachable and required
  configuration (`DATABASE_URL`, `SESSION_SECRET`) is present; returns
  `503` otherwise.

`compose.yml`'s Docker healthchecks already use these (the `api` service's
healthcheck calls `/api/ready`; `postgres` uses `pg_isready`; `worker` has no
HTTP listener, so its healthcheck confirms the Node process is still
running). Check current health with:

```bash
docker compose ps
```

An unhealthy `api` container after several retries usually means Postgres
isn't reachable or a required env var is missing/invalid - check
`docker compose logs api` and `.env`.

## 10. Backups

Configure a daily cron job (or DSM **Control Panel → Task Scheduler →
Create → Scheduled Task → User-defined script**) to run:

```bash
cd /volume1/docker/dharma-events && ./scripts/backup.sh >> "${BACKUP_DIR:-/volume1/docker/dharma-events/backups}/backup.log" 2>&1
```

This produces `pg_dump | gzip` backups under `$BACKUP_DIR/database/` with a
7-daily / 4-weekly / 6-monthly rotation (Section 59), plus a `.env` +
Compose/Nginx configuration snapshot under `$BACKUP_DIR/config/`.

**Restore** (destructive - overwrites the live database):

```bash
./scripts/restore.sh /volume1/docker/dharma-events/backups/database/daily/dharma_events_20260101_020000.sql.gz
```

The script requires you to type the database name to confirm before
proceeding when run interactively.

**Test your restore procedure periodically** - a backup you've never
restored from is not a verified backup.

### Perform a test restore (do this once, right after your first backup)

Verify the whole backup → restore cycle actually works before you rely on
it in a real incident:

```bash
# 1. Take a fresh backup.
./scripts/backup.sh

# 2. Note the dump it just created.
ls -t "${BACKUP_DIR:-./backups}"/database/daily/*.sql.gz | head -1

# 3. Restore it back into the same (or a scratch) database, confirming
#    interactively when prompted.
./scripts/restore.sh "$(ls -t "${BACKUP_DIR:-./backups}"/database/daily/*.sql.gz | head -1)"

# 4. Spot-check that the app still works and row counts look sane, e.g.:
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT count(*) FROM registrations;"
```

Repeat this drill periodically (e.g. quarterly) so a restore is never the
first time you've run the script for real.

Additionally configure **Synology Hyper Backup** (Section 59's recommended
secondary backup) to back up the whole `$BACKUP_DIR` folder (and optionally
the entire `dharma-events` folder) to an external/off-NAS destination, for
protection against NAS-level failure.

## 11. Updating the deployment

```bash
cd /volume1/docker/dharma-events
git pull
docker compose up -d --build
docker compose exec api sh -c "cd /repo/packages/database && node_modules/.bin/prisma migrate deploy"
```

Compose recreates only the containers whose image actually changed;
Postgres data in the `postgres-data` named volume is untouched. Run a backup
(`./scripts/backup.sh`) before any update that includes a database schema
migration. `prisma migrate deploy` is safe to re-run even when there are no
new migrations - it's a no-op in that case.

## 12. Known limitations / gaps

- **Event Snapshot** (REQUIREMENTS.md Section 60 - an admin action that
  triggers a backup and records a timestamped metrics snapshot before an
  event opens) is not implemented as a dedicated feature. It's not listed in
  Phase 8's literal "Implement"/acceptance-criteria bullets (Section 82),
  and its two building blocks - an on-demand database backup and point-in-
  time event metrics - are already available separately via
  `./scripts/backup.sh` and the dashboard/reports endpoints. Treat this as a
  documented gap for a future phase rather than something silently missing.
