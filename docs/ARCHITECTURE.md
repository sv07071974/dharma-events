# Dharma Events — Architecture

This document provides a technical view of runtime components, data flow, and operational hotspots.

## 1. Workspace layout

| Area | Path | Purpose |
|---|---|---|
| API | `apps/api` | Fastify HTTP API, auth, imports, check-ins, reports |
| Web | `apps/web` | React SPA (Vite), operator UI, scanner flow |
| Worker | `apps/worker` | Invitation queue processing, retries, email sends |
| Database package | `packages/database` | Prisma schema, migrations, generated client |
| Shared package | `packages/shared` | Env validation, QR/token, PDF/email helper logic |

## 2. System context

```mermaid
flowchart LR
    U[Users / Operators] --> W[Web UI\nReact + Vite + Nginx]
    W -->|HTTPS + Cookie Session| A[API\nFastify]
    A -->|Prisma| P[(PostgreSQL)]
    A -->|Create invitation_jobs| P
    K[Worker] -->|Poll pending jobs| P
    K -->|SMTP / Mail API| M[Email Provider]
    K -->|Update status + attempts| P
```

## 3. Core domain model

```mermaid
erDiagram
    USER ||--o{ SESSION : has
    USER ||--o{ AUDIT_LOG : writes
    EVENT ||--o{ CATEGORY : contains
    EVENT ||--o{ VOLUNTEER : assigns
    EVENT ||--o{ REGISTRATION : receives
    REGISTRATION ||--o{ INVITATION_JOB : queues
    REGISTRATION ||--o{ CHECKIN : records
    USER ||--o{ CHECKIN : performs
```

## 4. Invitation processing flow

```mermaid
sequenceDiagram
    participant UI as Web UI
    participant API as API (Fastify)
    participant DB as PostgreSQL
    participant WRK as Worker
    participant MAIL as Email Provider

    UI->>API: Trigger invitation send
    API->>DB: Insert invitation_jobs (PENDING)
    WRK->>DB: Poll due jobs (PENDING/FAILED + nextAttemptAt)
    WRK->>MAIL: Send email + PDF attachments
    alt success
        WRK->>DB: Mark SENT, set sentAt
    else failure
        WRK->>DB: Mark FAILED, increment attemptCount,\nset nextAttemptAt (backoff)
    end
```

## 5. Design choices and implications

1. **Single Postgres source of truth**: all operational data is persisted in one relational store with Prisma migrations.
2. **Attachments in database (`bytea`)**: simplifies deployment (no shared volume) but increases backup size and restore time.
3. **Immutable check-in and audit rows**: preserves history and supports compliance/auditability.
4. **Dedicated worker for async tasks**: avoids blocking request/response flows and enables retry policies.

## 6. Hotspots to monitor

1. **Storage growth**: binary invite attachments can grow `events/categories` row size and total DB footprint.
2. **Job latency**: watch backlog and retry rate in `invitation_jobs` to detect mailer degradation.
3. **Security posture**: enforce HTTPS and secure cookie/session settings in production.
4. **Native dependencies in CI/CD**: ensure target-compatible builds for native modules (e.g., argon2 bindings).

## 7. Related docs

- `docs/QUICKSTART.md`
- `docs/SYNOLOGY_DEPLOYMENT.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `DHARMA_EVENTS_REQUIREMENTS_AND_DESIGN.md`
