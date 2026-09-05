# Dharma Events PWA
## Product Requirements & Technical Design Specification

**Document Version:** 1.0  
**Target Platform:** Progressive Web App (PWA)  
**Deployment Target:** Synology NAS using Docker Compose / Container Manager  
**Primary Use Case:** Event registration, QR invitation delivery, participant check-in, attendance tracking, and event dashboard  
**Development Mode:** Autonomous AI-assisted development using Copilot CLI + Claude Sonnet  
**Initial Event:** myDharma Fest 2026  
**Design Goal:** Reusable platform for future community and social events  

---

# 1. Purpose

Dharma Events is a lightweight, self-hosted event management platform designed for community and social events.

The system must support the complete event flow:

1. Import participant registrations from Excel/CSV.
2. Validate registration data.
3. Assign a unique registration ID.
4. Generate a secure QR code for each registration.
5. Send a personalized invitation email with QR attachment.
6. Optionally copy the assigned volunteer.
7. Allow volunteers to scan participant QR codes at the event.
8. Support manual participant search when QR scanning is not possible.
9. Record attendance and partial family attendance.
10. Prevent or flag duplicate check-ins.
11. Provide live attendance dashboards.
12. Export attendance and audit reports.
13. Run completely on a Synology NAS.

The application should be reusable for multiple future events.

---

# 2. Key Product Principles

The implementation must follow these principles:

- Keep the platform simple and reliable.
- Optimize for mobile use at event counters.
- Avoid unnecessary infrastructure.
- Avoid vendor lock-in.
- Host application and database on Synology NAS.
- Keep participant personal data private.
- Do not store personal information inside QR codes.
- Support multiple counters scanning simultaneously.
- Maintain an immutable audit trail of check-in activity.
- Build as a reusable event platform rather than a one-off application.
- Prefer simple, proven technologies over complex frameworks.
- All critical event-day workflows must work with minimum navigation.

---

# 3. Primary Users

## 3.1 Administrator

Full system access.

Responsibilities:

- Create and manage events.
- Import registrations.
- Manage categories.
- Manage volunteers.
- Generate QR invitations.
- Send and resend invitations.
- View all registrations.
- Correct participant information.
- Manage users and roles.
- View dashboards and reports.
- Perform check-in overrides.
- Configure SMTP.
- Configure event settings.
- Export attendance reports.

---

## 3.2 Event Manager

Event-level management access.

Can:

- View and edit registrations.
- Import registrations.
- Manage volunteers.
- Manage categories.
- Send invitations.
- View dashboard.
- View event reports.
- Perform manual check-in.
- Manage event settings.

Cannot:

- Manage platform-wide settings.
- Manage system administrators.
- Change infrastructure configuration.

---

## 3.3 Supervisor

Operational event-day user.

Can:

- Scan QR codes.
- Search participants.
- Check participants in.
- Perform authorized check-in override.
- View operational dashboard.
- View recent check-ins.

Cannot:

- Import data.
- Send invitations.
- Manage users.
- Change event configuration.

---

## 3.4 Volunteer

Restricted event-day user.

Can:

- Login.
- Scan QR codes.
- Search participants.
- Record check-ins.
- View recent check-ins made by the volunteer.

Cannot:

- Export participant data.
- View system configuration.
- Send invitations.
- View participant email or phone unless explicitly permitted.
- Override a completed check-in.

---

# 4. Core User Journey

```text
Google Form / Excel
        |
        v
Import Registration Data
        |
        v
Validate Data
        |
        +---- Issues ----> Review / Fix
        |
        v
Generate Registration IDs
        |
        v
Generate Secure QR Tokens
        |
        v
Generate Invitation
        |
        v
Send Email
        |
        +---- Participant
        |
        +---- Assigned Volunteer (optional CC)
        |
        v
Event Day
        |
        v
Volunteer Scans QR
        |
        v
Server Validates Token
        |
        +---- Invalid ----> Reject / Manual Search
        |
        +---- Valid
                 |
                 v
          Confirm Attendee Count
                 |
                 v
             Check-In
                 |
                 v
           PostgreSQL
                 |
                 v
          Live Dashboard
                 |
                 v
              Reports
```

---

# 5. Initial Registration Data

The current registration source contains fields similar to:

- Timestamp
- Email
- Participant Name
- WhatsApp / Mobile Number
- Number of Attendees
- Participant / Volunteer / Event Selection

The revised import sheet should standardize to:

| Column | Required | Description |
|---|---:|---|
| Timestamp | No | Original registration timestamp |
| Email | Yes | Participant email |
| Participant Name | Yes | Primary registration contact |
| WhatsApp | No | Participant mobile number |
| No. of Attendees | Yes | Total people covered by registration |
| Category | Yes | Participant category |
| Volunteer Name | No | Assigned volunteer |
| Volunteer Email | No | Assigned volunteer email |

All operational fields must be generated by the system rather than maintained manually in Excel.

---

# 6. System-Generated Registration Fields

The application must generate and manage:

- Internal UUID
- Registration Number
- Event ID
- QR Token
- QR Token Hash
- Invitation Status
- Invitation Sent Timestamp
- Invitation Delivery Status
- Check-in Status
- Total Checked-in Count
- Last Check-in Time
- Created Timestamp
- Updated Timestamp
- Duplicate Warning Flag
- Data Validation Status

Example registration number:

```text
MDF26-0001
MDF26-0002
MDF26-0003
```

Registration numbers must be unique within an event and must never change.

---

# 7. Multi-Event Design

The application must support multiple events.

Example:

```text
Dharma Events
|
+-- myDharma Fest 2026
|
+-- Annual Satsang 2027
|
+-- Future Community Event
```

Every event must have its own:

- Registrations
- Categories
- Volunteers
- Invitations
- QR codes
- Check-ins
- Dashboard
- Reports
- Configuration

Data between events must remain logically separated.

---

# 8. Recommended Technology Stack

## 8.1 Frontend

Use:

- React
- TypeScript
- Vite
- React Router
- TanStack Query or equivalent
- Vite PWA Plugin
- ZXing for browser QR scanning
- IndexedDB abstraction such as Dexie for future offline capability

Frontend requirements:

- Responsive.
- Mobile-first.
- Touch-friendly.
- Installable as a PWA.
- Must work on:
  - iPhone
  - Android
  - iPad
  - Mac
  - Windows
- Must not require App Store or Play Store deployment.

---

## 8.2 Backend

Use:

- Node.js
- TypeScript
- Fastify
- Zod for request/response validation
- Prisma ORM or Drizzle ORM
- JWT or secure session-cookie authentication

Preferred choice:

```text
Fastify + TypeScript + Prisma + PostgreSQL
```

---

## 8.3 Database

Use PostgreSQL.

Do not use SQLite for production.

Reasons:

- Multiple volunteers may check participants in concurrently.
- Transactions are required.
- Strong constraints are required.
- Reliable backups are required.
- Future event growth should not require database migration.

---

## 8.4 Email

Use generic SMTP.

Do not hard-code a single email provider.

Required configuration:

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USERNAME
SMTP_PASSWORD
SMTP_FROM_EMAIL
SMTP_FROM_NAME
```

Must work with providers such as:

- Gmail
- Google Workspace
- Microsoft 365
- Synology MailPlus
- Other SMTP services

Use Nodemailer or equivalent.

---

## 8.5 PDF and QR Generation

Use:

- QR generation library such as `qrcode`
- PDF generation library such as `pdf-lib`, `PDFKit`, or equivalent

The QR code must be rendered:

- Inline in email where supported.
- In a PDF invitation attachment.
- In admin preview.

---

# 9. High-Level Architecture

```text
                       Internet
                          |
                       HTTPS 443
                          |
                          v
                 Synology Reverse Proxy
                          |
                  events.sansmi.org
                          |
          +---------------+----------------+
          |                                |
          v                                v
       Web PWA                           REST API
 React / TypeScript                  Node / Fastify
          |                                |
          +----------------+---------------+
                           |
                           v
                      PostgreSQL
                           |
             +-------------+--------------+
             |                            |
             v                            v
        Check-in Data                Audit Logs
             |
             v
        Email Job Queue
             |
             v
        Background Worker
             |
             v
            SMTP
```

---

# 10. Container Architecture

Deploy using Synology Container Manager and Docker Compose.

Required services:

```text
dharma-events
|
+-- web
|
+-- api
|
+-- worker
|
+-- postgres
```

Redis is optional and should not be introduced in V1 unless needed.

For V1, PostgreSQL can also act as the source of truth for queued email jobs.

---

# 11. Recommended Repository Structure

```text
dharma-events/
|
+-- apps/
|   |
|   +-- web/
|   |
|   +-- api/
|   |
|   +-- worker/
|
+-- packages/
|   |
|   +-- database/
|   |
|   +-- shared/
|   |
|   +-- ui/
|
+-- docker/
|
+-- docs/
|
+-- scripts/
|
+-- compose.yml
|
+-- compose.dev.yml
|
+-- .env.example
|
+-- README.md
|
+-- REQUIREMENTS.md
```

Use a single monorepo.

Recommended package manager:

```text
pnpm
```

---

# 12. Database Design

## 12.1 users

```text
id UUID PK
email VARCHAR UNIQUE
password_hash VARCHAR
name VARCHAR
role ENUM
active BOOLEAN
created_at TIMESTAMP
updated_at TIMESTAMP
```

Roles:

```text
ADMIN
EVENT_MANAGER
SUPERVISOR
VOLUNTEER
```

---

## 12.2 events

```text
id UUID PK
event_code VARCHAR UNIQUE
event_name VARCHAR
description TEXT
event_date DATE
venue VARCHAR
status ENUM
registration_open BOOLEAN
checkin_open BOOLEAN
created_at TIMESTAMP
updated_at TIMESTAMP
```

Suggested statuses:

```text
DRAFT
ACTIVE
COMPLETED
ARCHIVED
```

---

## 12.3 categories

```text
id UUID PK
event_id UUID FK
name VARCHAR
description VARCHAR
active BOOLEAN
sort_order INTEGER
created_at TIMESTAMP
updated_at TIMESTAMP
```

Example categories:

- Participant
- Volunteer
- Satsang
- Guest
- VIP
- Speaker
- Organiser

Categories must be configurable per event.

---

## 12.4 volunteers

```text
id UUID PK
event_id UUID FK
user_id UUID FK NULLABLE
name VARCHAR
email VARCHAR
phone VARCHAR NULLABLE
role VARCHAR
active BOOLEAN
created_at TIMESTAMP
updated_at TIMESTAMP
```

---

## 12.5 registrations

```text
id UUID PK
event_id UUID FK
registration_no VARCHAR
source_timestamp TIMESTAMP NULLABLE
name VARCHAR
email VARCHAR
phone VARCHAR NULLABLE
registered_count INTEGER
category_id UUID FK
volunteer_id UUID FK NULLABLE
qr_token_hash VARCHAR
invitation_status ENUM
invitation_sent_at TIMESTAMP NULLABLE
validation_status ENUM
duplicate_flag BOOLEAN
notes TEXT NULLABLE
created_at TIMESTAMP
updated_at TIMESTAMP
```

Unique constraint:

```text
(event_id, registration_no)
```

Do not enforce email uniqueness because families or legitimate duplicate registrations may exist.

---

## 12.6 checkins

Every check-in must be stored as a transaction.

```text
id UUID PK
event_id UUID FK
registration_id UUID FK
attendee_count INTEGER
checked_in_at TIMESTAMP
checked_in_by UUID FK
counter_name VARCHAR NULLABLE
device_id VARCHAR NULLABLE
status ENUM
notes VARCHAR NULLABLE
created_at TIMESTAMP
```

Suggested statuses:

```text
VALID
OVERRIDE
REVERSED
```

Never use only a `checked_in = true` field as the source of truth.

Total arrivals must be calculated from valid check-in transactions.

---

## 12.7 invitation_jobs

```text
id UUID PK
event_id UUID FK
registration_id UUID FK
status ENUM
attempt_count INTEGER
last_attempt_at TIMESTAMP NULLABLE
sent_at TIMESTAMP NULLABLE
error_message TEXT NULLABLE
created_at TIMESTAMP
updated_at TIMESTAMP
```

Statuses:

```text
PENDING
PROCESSING
SENT
FAILED
CANCELLED
```

---

## 12.8 audit_logs

```text
id UUID PK
event_id UUID FK NULLABLE
user_id UUID FK NULLABLE
action VARCHAR
entity_type VARCHAR
entity_id UUID NULLABLE
metadata JSONB
ip_address VARCHAR NULLABLE
created_at TIMESTAMP
```

Examples:

```text
LOGIN
REGISTRATION_IMPORT
REGISTRATION_EDIT
INVITATION_SEND
INVITATION_RESEND
CHECK_IN
CHECKIN_OVERRIDE
CHECKIN_REVERSE
EVENT_UPDATE
USER_CREATE
```

Audit logs should be append-only from the application.

---

# 13. QR Security Design

QR codes must never contain participant personal data.

Do not encode:

```text
Name
Email
Mobile
Category
```

Instead generate a cryptographically random token.

Example:

```text
https://events.sansmi.org/q/Tm7vQ9L2x8PkF3dS
```

Recommended token:

- At least 128 bits of randomness.
- URL-safe.
- Generated using Node `crypto.randomBytes()`.

Store only a hash of the token in PostgreSQL.

Example:

```text
raw token
   |
SHA-256
   |
database
```

When QR is scanned:

```text
token from URL
   |
hash
   |
find matching registration
```

Raw tokens must not appear in logs.

---

# 14. QR Validation Rules

When a QR is scanned, the API must validate:

1. Token is syntactically valid.
2. Token exists.
3. Registration belongs to selected event.
4. Event is active.
5. Check-in is currently allowed.
6. Registration is not cancelled.
7. Registered attendee count is greater than zero.
8. Remaining attendee count is calculated.

Response should include only data required by scanner:

```json
{
  "registrationNo": "MDF26-0042",
  "name": "Example Participant",
  "category": "Participant",
  "registeredCount": 4,
  "checkedInCount": 2,
  "remainingCount": 2,
  "assignedVolunteer": "Example Volunteer"
}
```

Do not return email or phone to the scanner unless explicitly required.

---

# 15. Registration Import

Admin must be able to import:

- `.xlsx`
- `.csv`

Import flow:

```text
Upload File
   |
   v
Read Headers
   |
   v
Map Columns
   |
   v
Validate
   |
   v
Preview
   |
   +---- Errors
   |
   +---- Warnings
   |
   v
Confirm Import
```

---

# 16. Import Validation Rules

Validate:

- Missing name.
- Missing email.
- Invalid email.
- Attendee count <= 0.
- Missing category.
- Unknown category.
- Invalid volunteer email.
- Duplicate email.
- Duplicate phone.
- Duplicate name + email.
- Duplicate registration rows.
- Unexpected attendee counts.
- Malformed phone numbers.

Duplicates should usually be warnings, not automatically rejected.

The user must be able to review suspected duplicates.

---

# 17. Registration Import Preview

Example:

```text
62 rows detected

58 Valid
3 Warnings
1 Error

Warnings
- Duplicate email: 2
- Duplicate mobile: 1

Errors
- Missing participant email: 1

[Download Issues]
[Import Valid Rows]
[Cancel]
```

No email or QR generation should happen automatically after import.

---

# 18. Invitation Workflow

Admin screen:

```text
Invitations
---------------------------------

Total registrations       62
Ready                     57
Already sent               0
Pending                     5
Failed                      0

[Generate Invitations]
[Send Selected]
[Send All Ready]
```

Bulk sending must always require explicit admin action.

---

# 19. Invitation Content

Each participant should receive:

- Event name.
- Participant name.
- Registration ID.
- Registered attendee count.
- Event date.
- Venue.
- Event instructions.
- QR image.
- PDF invitation attachment.

Example PDF:

```text
+--------------------------------+
|        myDharma Fest 2026      |
|                                |
|       PARTICIPANT NAME         |
|                                |
|      Registration ID           |
|        MDF26-0042              |
|                                |
|         [ QR CODE ]            |
|                                |
|      Registered Guests: 3      |
|                                |
| Present this QR at check-in.   |
+--------------------------------+
```

Filename:

```text
MDF26-0042-Invitation.pdf
```

---

# 20. Email Recipient Rules

Default:

```text
TO: participant email
```

Configurable:

```text
CC assigned volunteer
CC event registration mailbox
CC event administrator
```

Recommendation:

- Participant: enabled.
- Volunteer: optional.
- Shared counter mailbox: disabled by default.

The counter application should be the primary fallback for lost invitations.

---

# 21. Email Queue Design

Never send bulk email inside an HTTP request.

Flow:

```text
Admin clicks Send
        |
        v
Create invitation_jobs rows
        |
        v
Worker polls pending jobs
        |
        v
Generate QR / PDF
        |
        v
Send SMTP message
        |
        v
Update job status
```

Worker should:

- Process configurable batch size.
- Retry transient failures.
- Stop retrying permanent failures.
- Store readable error messages.
- Never expose SMTP password in logs.

Suggested retry policy:

```text
Attempt 1: immediate
Attempt 2: +1 minute
Attempt 3: +5 minutes
Attempt 4: +30 minutes
```

---

# 22. PWA Requirements

Application manifest must include:

- Name.
- Short name.
- Start URL.
- Theme metadata.
- App icons.
- Display mode: standalone.

The service worker must cache:

- App shell.
- JavaScript.
- CSS.
- Icons.
- Scanner dependencies.

The app should show install instructions when appropriate.

---

# 23. Scanner UX

Scanner must be optimized for event volunteers.

Main screen:

```text
myDharma Fest 2026

[ SCAN QR ]

---------------------

Search Participant

[ Name / Phone / Reg ID ]

Recent Check-ins
```

Scanner must minimize taps.

---

# 24. Camera QR Scanning

Use ZXing.

Requirements:

- Request camera only when user presses Scan.
- Prefer rear camera on phones.
- Clear camera permission failure message.
- Allow manual fallback.
- Avoid continuous duplicate reads from the same QR.
- Pause scanner after successful detection.
- Resume only after check-in completed or cancelled.

---

# 25. Successful QR Scan

Display:

```text
VALID REGISTRATION

MDF26-0042

Participant Name

Category
Participant

Registered
4 attendees

Already arrived
2

Remaining
2

Arriving now
[-] 2 [+]

[CHECK IN]
```

The default "Arriving now" should equal remaining attendees.

Allow volunteer to reduce the number.

Do not allow a value greater than remaining attendees without supervisor override.

---

# 26. Partial Family Check-In

Example:

Registration has 4 attendees.

First arrival:

```text
Registered: 4
Already arrived: 0
Arriving now: 2
```

Result:

```text
Checked in total: 2
Remaining: 2
```

Second arrival later:

```text
Registered: 4
Already arrived: 2
Arriving now: 2
```

Result:

```text
Checked in total: 4
Remaining: 0
```

---

# 27. Duplicate Check-In Handling

If registration is fully checked in:

```text
ALREADY FULLY CHECKED IN

Registration: MDF26-0042

Registered: 4
Checked in: 4

Last check-in:
18:34

Counter:
Counter 2
```

Volunteer must not be able to check in more attendees.

Supervisor may perform an override.

Override must require:

- Supervisor role.
- Reason.
- Audit record.

---

# 28. Manual Participant Search

Search must support:

- Name.
- Registration number.
- Email.
- Mobile number.

Results should prioritize exact matches.

Display minimum information required.

Example:

```text
MDF26-0042
Participant Name
Registered: 4
Arrived: 2

[Open]
```

Normal volunteers should not see full email/mobile values in search results unless required.

---

# 29. Dashboard

Primary cards:

```text
REGISTERED
181

ARRIVED
126

REMAINING
55

ATTENDANCE
69.6%
```

Additional metrics:

- Total registrations.
- Total attendee capacity.
- Total arrivals.
- Remaining attendees.
- Percentage attendance.
- Fully checked-in registrations.
- Partially checked-in registrations.
- Not arrived registrations.

---

# 30. Dashboard Breakdowns

Required:

## By Category

```text
Participant       82 / 100
Satsang           29 / 42
Guest             15 / 39
```

## By Volunteer

```text
Volunteer A       28 / 32
Volunteer B       21 / 30
Volunteer C       17 / 25
```

## Arrival Timeline

Example hourly chart:

```text
17:00   ███
18:00   █████████
19:00   █████████████
20:00   █████
```

## Recent Check-Ins

Display:

- Time.
- Participant.
- Attendee count.
- Volunteer.
- Counter.

---

# 31. Dashboard Refresh

For V1:

Use polling every 5 seconds.

Do not introduce WebSockets unless necessary.

Polling is acceptable for expected event load and is easier to operate.

---

# 32. Reports

Required exports:

- Complete registration list.
- Attendance report.
- No-show report.
- Partially checked-in report.
- Volunteer assignment report.
- Check-in transaction report.
- Invitation delivery report.
- Failed invitation report.
- Audit report.

Export formats:

- CSV
- XLSX where practical

---

# 33. Offline Mode

Offline check-in is a V2 feature.

V1 requires:

- PWA app shell caching.
- Clear network status.
- Graceful handling of temporary API failure.

V2 should support:

```text
Download Event Data
        |
        v
IndexedDB
        |
        v
Offline QR Scan
        |
        v
Local Check-In Queue
        |
        v
Network Returns
        |
        v
Synchronize
```

Offline data should contain only minimal information:

- Registration number.
- QR hash / local validation token.
- Name.
- Category.
- Registered attendee count.
- Existing checked-in count.

Avoid caching email and phone unless required.

---

# 34. Authentication

V1 authentication:

- Email.
- Password.
- Secure session cookie.

Password hashing:

Use Argon2id or bcrypt with appropriate cost.

Preferred:

```text
Argon2id
```

Session cookie requirements:

- HttpOnly.
- Secure.
- SameSite=Lax or Strict.
- Appropriate expiry.
- Server-side session validation or securely signed token.

---

# 35. Authorization

Every API route must enforce role authorization on the server.

Never rely on hidden frontend buttons for security.

Example:

```text
POST /api/checkins
VOLUNTEER+
```

```text
POST /api/checkins/override
SUPERVISOR+
```

```text
POST /api/import
EVENT_MANAGER+
```

```text
POST /api/users
ADMIN
```

---

# 36. Security Requirements

Mandatory:

- HTTPS only.
- Strong password hashing.
- Rate-limit login endpoint.
- Rate-limit QR lookup endpoints.
- Validate all request bodies.
- Sanitize Excel/CSV inputs.
- Use parameterized database operations.
- CSRF protection where relevant.
- Secure cookies.
- Do not expose database port publicly.
- Do not expose raw QR tokens in logs.
- Do not expose SMTP credentials.
- Protect admin endpoints.
- Add security headers.
- Limit file upload size.
- Allow only expected file types.
- Maintain audit logs.

---

# 37. Privacy Requirements

Volunteers should see only operational data.

Scanner normally displays:

- Name.
- Registration ID.
- Category.
- Registered count.
- Checked-in count.
- Assigned volunteer.

Scanner should not display by default:

- Full email.
- Full phone number.
- Internal notes.

Admins may view full registration details.

---

# 38. API Design

Base path:

```text
/api/v1
```

---

# 39. Authentication APIs

```text
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

---

# 40. Event APIs

```text
GET    /api/v1/events
POST   /api/v1/events
GET    /api/v1/events/:eventId
PATCH  /api/v1/events/:eventId
DELETE /api/v1/events/:eventId
```

Deletion should preferably soft-delete or archive events.

---

# 41. Category APIs

```text
GET    /api/v1/events/:eventId/categories
POST   /api/v1/events/:eventId/categories
PATCH  /api/v1/categories/:categoryId
DELETE /api/v1/categories/:categoryId
```

---

# 42. Volunteer APIs

```text
GET    /api/v1/events/:eventId/volunteers
POST   /api/v1/events/:eventId/volunteers
PATCH  /api/v1/volunteers/:volunteerId
DELETE /api/v1/volunteers/:volunteerId
```

---

# 43. Registration APIs

```text
GET    /api/v1/events/:eventId/registrations
POST   /api/v1/events/:eventId/registrations
GET    /api/v1/registrations/:registrationId
PATCH  /api/v1/registrations/:registrationId
```

Search:

```text
GET /api/v1/events/:eventId/registrations/search?q=
```

---

# 44. Import APIs

```text
POST /api/v1/events/:eventId/import/preview
POST /api/v1/events/:eventId/import/commit
```

Preview must never persist registrations.

Commit must use an import transaction.

---

# 45. Invitation APIs

```text
GET  /api/v1/events/:eventId/invitations
POST /api/v1/events/:eventId/invitations/generate
POST /api/v1/events/:eventId/invitations/send
POST /api/v1/registrations/:registrationId/invitation/resend
GET  /api/v1/invitation-jobs/:jobId
```

---

# 46. QR APIs

Do not expose a public endpoint that leaks registration data.

Scanner validation:

```text
POST /api/v1/events/:eventId/qr/validate
```

Request:

```json
{
  "token": "opaque-token"
}
```

Response:

```json
{
  "valid": true,
  "registration": {
    "id": "uuid",
    "registrationNo": "MDF26-0042",
    "name": "Participant Name",
    "category": "Participant",
    "registeredCount": 4,
    "checkedInCount": 2,
    "remainingCount": 2
  }
}
```

---

# 47. Check-In APIs

```text
POST /api/v1/events/:eventId/checkins
GET  /api/v1/events/:eventId/checkins/recent
POST /api/v1/checkins/:checkinId/reverse
POST /api/v1/events/:eventId/checkins/override
```

Check-in request:

```json
{
  "registrationId": "uuid",
  "attendeeCount": 2,
  "counterName": "Counter 2"
}
```

Server must calculate remaining capacity again inside the transaction.

Never trust the remaining count supplied by frontend.

---

# 48. Dashboard APIs

```text
GET /api/v1/events/:eventId/dashboard/summary
GET /api/v1/events/:eventId/dashboard/categories
GET /api/v1/events/:eventId/dashboard/volunteers
GET /api/v1/events/:eventId/dashboard/timeline
GET /api/v1/events/:eventId/dashboard/recent
```

---

# 49. Report APIs

```text
GET /api/v1/events/:eventId/reports/attendance
GET /api/v1/events/:eventId/reports/no-show
GET /api/v1/events/:eventId/reports/checkins
GET /api/v1/events/:eventId/reports/invitations
```

---

# 50. Concurrency Requirements

Multiple volunteers may scan the same registration simultaneously.

The check-in operation must be transactional.

Required logic:

```text
BEGIN TRANSACTION

Lock registration or calculate total with suitable database isolation

registered = registration.registered_count
checkedIn = SUM(valid checkins)
remaining = registered - checkedIn

IF requestedCount > remaining
    reject

INSERT checkin

COMMIT
```

The application must prevent over-check-in caused by race conditions.

---

# 51. Frontend Route Structure

Suggested routes:

```text
/login

/dashboard

/events

/events/:eventId

/events/:eventId/registrations

/events/:eventId/import

/events/:eventId/volunteers

/events/:eventId/invitations

/events/:eventId/scan

/events/:eventId/reports

/admin/users

/admin/settings
```

---

# 52. Event Mode

Provide a simplified event-day mode.

When enabled, volunteers primarily see:

```text
SCAN QR

SEARCH PARTICIPANT

RECENT CHECK-INS
```

Hide administrative navigation.

This is important because event counters must operate quickly under queue pressure.

---

# 53. Synology Deployment

Target directory:

```text
/volume1/docker/dharma-events/
|
+-- compose.yml
|
+-- .env
|
+-- postgres/
|   |
|   +-- data/
|
+-- uploads/
|
+-- invitations/
|
+-- backups/
|
+-- logs/
```

Source code does not need to live permanently in these data directories.

---

# 54. Docker Compose Requirements

Compose should define:

- `web`
- `api`
- `worker`
- `postgres`

Use:

- Internal Docker network.
- Persistent PostgreSQL volume.
- Restart policies.
- Health checks.
- Environment variable injection.
- No public PostgreSQL port.

Example conceptual port mapping:

```text
web:
  host 8088 -> container 80

api:
  internal only

postgres:
  internal only
```

The web container should proxy `/api` to the API container.

---

# 55. Web Container

Use Nginx.

Responsibilities:

- Serve React static files.
- SPA fallback.
- Cache static assets.
- Proxy `/api` to API container.
- Add compression.
- Apply security headers where appropriate.

---

# 56. Synology Reverse Proxy

Public URL:

```text
https://events.sansmi.org
```

Synology reverse proxy:

```text
Source:
HTTPS
events.sansmi.org
443

Destination:
HTTP
localhost
8088
```

Do not expose application container ports individually to the internet.

---

# 57. HTTPS

HTTPS is mandatory because:

- Authentication requires secure cookies.
- Browser camera access requires secure context.
- Participant data must be encrypted in transit.
- PWA service workers require secure context.

Use a Let's Encrypt certificate assigned to:

```text
events.sansmi.org
```

---

# 58. Router / Firewall

Preferred exposure:

```text
TCP 443 -> Synology NAS
```

Avoid exposing:

- PostgreSQL 5432.
- API container port.
- DSM administration port.
- Worker ports.

Port 80 may be temporarily or permanently required depending on certificate and redirect configuration.

---

# 59. Backups

Perform daily PostgreSQL backups.

Example:

```text
pg_dump
   |
gzip
   |
/backups/database/
```

Retention:

```text
7 daily
4 weekly
6 monthly
```

Additionally back up:

- `.env` securely.
- Generated invitation assets if required.
- Upload/import archive if retained.
- Compose configuration.

Use Synology Hyper Backup for secondary backup where available.

---

# 60. Event Snapshot

Admin should provide a logical event snapshot action before event opening.

Minimum implementation:

- Trigger database backup.
- Record snapshot timestamp.
- Record current event metrics.

Example:

```text
MDF2026-PRE-EVENT
2026-08-30 16:45
```

---

# 61. Logging

Use structured JSON logging.

Log:

- Request ID.
- Route.
- HTTP status.
- User ID.
- Duration.
- Error type.

Do not log:

- Passwords.
- SMTP credentials.
- Raw QR tokens.
- Full authentication tokens.

---

# 62. Monitoring

V1 health endpoints:

```text
GET /health
GET /ready
```

`/health` confirms process is running.

`/ready` confirms:

- Database available.
- Required configuration present.

Docker health checks should use these endpoints.

---

# 63. Testing Requirements

## Unit Tests

Test:

- Registration ID generation.
- QR token hashing.
- Email validation.
- Import validation.
- Attendee count calculations.
- Permission rules.
- Invitation job retries.

---

## API Integration Tests

Test:

- Login.
- Event creation.
- Registration import.
- QR validation.
- Check-in.
- Partial check-in.
- Duplicate check-in.
- Concurrent check-in.
- Supervisor override.
- Invitation queue.
- Dashboard metrics.

---

## Frontend Tests

Test:

- Login.
- Registration list.
- Import preview.
- Scanner workflow.
- Manual search.
- Check-in confirmation.
- Duplicate warning.
- Dashboard rendering.
- Mobile layouts.

Use Playwright for end-to-end testing.

---

# 64. Critical Event-Day Test Scenarios

Before production, simulate:

1. Valid QR.
2. Invalid QR.
3. QR from another event.
4. Participant not found.
5. Family of four checking in together.
6. Family arriving in two groups.
7. Same QR scanned twice.
8. Two volunteers scanning same QR simultaneously.
9. Volunteer loses connectivity.
10. API temporarily unavailable.
11. Database restarts.
12. Participant has no QR.
13. Search by phone.
14. Search by name.
15. Supervisor override.
16. Incorrect check-in reversal.
17. More than 10 simultaneous counters.
18. 1,000+ registrations.
19. Bulk invitation send.
20. SMTP failure.
21. Email retry.
22. NAS restart.

---

# 65. Performance Targets

The application should comfortably support:

```text
1,000+ registrations
10+ counters
20+ concurrent users
```

Target:

- QR validation API < 500 ms on LAN/WAN under normal conditions.
- Check-in operation < 500 ms under normal conditions.
- Search response < 1 second.
- Dashboard refresh < 2 seconds.
- Page first usable load < 3 seconds on normal mobile internet after initial install.
- Cached PWA shell should load near instantly.

---

# 66. Accessibility

Minimum:

- Proper button labels.
- Keyboard accessibility.
- Visible focus state.
- High-contrast status indicators.
- Do not communicate success/failure using color alone.
- Touch targets approximately 44px minimum.
- Scanner workflow usable one-handed.

---

# 67. Error Handling

User-facing error messages must be clear.

Avoid:

```text
HTTP 500
Unknown Error
```

Prefer:

```text
Unable to complete check-in.
The server could not be reached.

Please retry.
```

or:

```text
This registration has already checked in all 4 attendees.
```

---

# 68. Configuration

Application configuration should be environment-driven.

`.env.example` should include:

```env
NODE_ENV=production

APP_NAME=Dharma Events
PUBLIC_URL=https://events.sansmi.org

DATABASE_URL=postgresql://...

SESSION_SECRET=

SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=
SMTP_FROM_NAME=

QR_TOKEN_BYTES=24

EMAIL_WORKER_BATCH_SIZE=10
EMAIL_MAX_RETRIES=4

LOG_LEVEL=info
```

Do not commit production `.env`.

---

# 69. Initial Event Setup

Create first event:

```text
Event:
myDharma Fest 2026

Code:
MDF26
```

Registration numbers:

```text
MDF26-0001
MDF26-0002
...
```

The platform must not contain logic specific only to this event.

---

# 70. V1 Scope

V1 must include:

- Multi-event support.
- PWA.
- Admin login.
- Event manager login.
- Supervisor login.
- Volunteer login.
- Role-based security.
- Event configuration.
- Categories.
- Volunteers.
- Excel/CSV import.
- Data validation.
- Duplicate detection.
- Registration IDs.
- Secure QR generation.
- Invitation PDF.
- Email queue.
- SMTP delivery.
- Invitation resend.
- Mobile QR scanner.
- Manual search.
- Partial check-in.
- Duplicate check-in protection.
- Supervisor override.
- Check-in reversal.
- Dashboard.
- Reports.
- Audit log.
- PostgreSQL.
- Docker deployment.
- Synology reverse proxy.
- HTTPS.
- Database backup.

---

# 71. V2 Scope

Do not implement these until V1 is stable:

- Full offline check-in.
- WhatsApp delivery.
- SMS delivery.
- Push notifications.
- Badge printing.
- Meal coupons.
- Seat allocation.
- Donation tracking.
- Multiple physical venues within one event.
- Self-registration portal.
- Google Sheets live synchronization.
- Advanced analytics.
- WebSockets.

---

# 72. Non-Goals for V1

Do not introduce:

- Kubernetes.
- Microservice orchestration.
- Kafka.
- RabbitMQ.
- Redis unless clearly justified.
- GraphQL.
- Complex identity provider integration.
- Native iOS app.
- Native Android app.
- Cloud database dependency.
- Cloud-only architecture.

Keep the system simple.

---

# 73. Autonomous Development Instructions

Claude Sonnet / Copilot CLI should treat this document as the product specification.

The agent should proceed autonomously while following these rules:

1. Do not ask for clarification where a reasonable engineering default exists.
2. Document assumptions in `docs/ASSUMPTIONS.md`.
3. Use secure defaults.
4. Keep dependencies minimal.
5. Prefer stable libraries.
6. Do not add features outside the scope.
7. Complete each phase fully before starting the next.
8. Add tests with every meaningful feature.
9. Run tests after every implementation phase.
10. Fix failing tests before continuing.
11. Run lint and TypeScript checks before completing each phase.
12. Keep database migrations committed.
13. Maintain `README.md` with setup instructions.
14. Maintain `.env.example`.
15. Never commit secrets.
16. Use Docker for production.
17. Keep local development easy.
18. Create seed data for development.
19. Maintain an implementation checklist.
20. Commit logical increments where Git operations are available.

---

# 74. Autonomous Build Plan

## Phase 0 — Repository Bootstrap

Create:

```text
apps/web
apps/api
apps/worker
packages/database
packages/shared
docs
```

Configure:

- pnpm workspace.
- TypeScript.
- ESLint.
- Prettier.
- Vitest.
- Playwright.
- Docker.
- Environment validation.

Acceptance criteria:

- `pnpm install` succeeds.
- `pnpm lint` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test` succeeds.
- `docker compose up` starts baseline services.

---

# 75. Phase 1 — Database and Authentication

Implement:

- PostgreSQL.
- Prisma/Drizzle.
- Migrations.
- Users.
- Roles.
- Authentication.
- Sessions.
- Admin bootstrap command.

Acceptance criteria:

- Admin can login.
- Invalid login rejected.
- Protected APIs reject anonymous users.
- Role middleware works.
- Password hashes are never returned.
- Tests pass.

---

# 76. Phase 2 — Event Management

Implement:

- Event CRUD.
- Categories.
- Volunteers.
- Event configuration.

Acceptance criteria:

- Admin creates event.
- Event manager can manage assigned event.
- Volunteer cannot change event configuration.
- Categories work per event.
- Volunteers work per event.

---

# 77. Phase 3 — Registration Management

Implement:

- Registration CRUD.
- Excel import.
- CSV import.
- Column mapping.
- Validation.
- Duplicate detection.
- Preview.
- Import commit.
- Registration ID generation.

Acceptance criteria:

- Current-style registration spreadsheet can be imported.
- Bad rows are identified.
- Preview does not write database data.
- Import is transactional.
- Duplicate warnings are visible.
- IDs are generated consistently.

---

# 78. Phase 4 — QR and Invitation System

Implement:

- Secure token generator.
- Token hash storage.
- QR image.
- PDF invitation.
- Invitation preview.
- Email template.
- Email job queue.
- Worker.
- SMTP delivery.
- Retry handling.
- Send/resend UI.

Acceptance criteria:

- Participant receives valid invitation.
- QR opens valid token.
- QR contains no PII.
- Failed SMTP delivery is recorded.
- Resend works.
- Worker survives restart.

---

# 79. Phase 5 — Scanner and Check-In

Implement:

- Scanner route.
- Camera access.
- ZXing.
- QR validation.
- Check-in confirmation.
- Partial check-in.
- Duplicate prevention.
- Manual search.
- Event mode.
- Recent check-ins.

Acceptance criteria:

- Mobile browser scans successfully.
- Valid QR displays participant.
- Invalid QR rejected.
- Partial check-in works.
- Fully checked-in registration cannot check in again.
- Search fallback works.
- Volunteer sees minimal data.

---

# 80. Phase 6 — Supervisor Operations

Implement:

- Override.
- Check-in reversal.
- Reason capture.
- Audit entries.

Acceptance criteria:

- Volunteer cannot override.
- Supervisor can override.
- Override requires reason.
- Reversal updates calculated attendance.
- All actions appear in audit log.

---

# 81. Phase 7 — Dashboard and Reports

Implement:

- Dashboard summary.
- Category metrics.
- Volunteer metrics.
- Arrival timeline.
- Recent activity.
- Reports.
- CSV/XLSX export.

Acceptance criteria:

- Dashboard matches database totals.
- Partial arrivals counted correctly.
- Reports reconcile with check-in records.
- Polling refresh works.

---

# 82. Phase 8 — Production Hardening

Implement:

- Security headers.
- Rate limiting.
- Health endpoints.
- Docker health checks.
- Production Nginx.
- Structured logs.
- Backup script.
- Restore documentation.
- Synology deployment documentation.

Acceptance criteria:

- Production Compose starts successfully.
- Database is not externally exposed.
- Health checks pass.
- Application survives container restart.
- Backup created.
- Restore tested.

---

# 83. Phase 9 — Event Simulation

Seed:

```text
1,000 registrations
10 volunteers
10 counters
multiple categories
partial family attendance
```

Simulate:

- Concurrent scans.
- Repeated QR scans.
- Bulk email queue.
- Dashboard polling.

Acceptance criteria:

- No over-check-in.
- No duplicate registration IDs.
- Dashboard remains responsive.
- No database deadlocks during normal load.
- Errors are logged clearly.

---

# 84. Definition of Done

A feature is complete only when:

- Code implemented.
- Types correct.
- Input validation added.
- Authorization added.
- Unit/integration tests added.
- Tests passing.
- Lint passing.
- No known critical security issues.
- Mobile UX verified where relevant.
- Documentation updated.

---

# 85. Coding Standards

Use:

- TypeScript strict mode.
- Async/await.
- Explicit schema validation.
- Central error handler.
- Dependency injection only where useful.
- Clear service/repository boundaries.
- Small focused functions.
- Consistent API response structure.

Avoid:

- `any`.
- Huge controllers.
- Hidden side effects.
- Business rules embedded in React components.
- Direct SQL from route handlers.
- Hard-coded environment values.
- Hard-coded event names.
- Hard-coded category names.

---

# 86. Suggested API Response Structure

Success:

```json
{
  "success": true,
  "data": {}
}
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "REGISTRATION_FULLY_CHECKED_IN",
    "message": "All registered attendees have already checked in."
  }
}
```

Use stable error codes.

---

# 87. Suggested UI Status Language

Use simple status labels:

```text
Ready
Sent
Failed
Not Arrived
Partially Arrived
Checked In
Invalid QR
Already Checked In
Offline
Sync Pending
```

Avoid technical wording in user-facing screens.

---

# 88. Backup Script Requirement

Create:

```text
scripts/backup.sh
```

Requirements:

- Run `pg_dump`.
- Compress output.
- Timestamp filename.
- Write to mounted backup directory.
- Delete expired backups according to retention policy.
- Exit non-zero on failure.
- Log success/failure.

Also create:

```text
scripts/restore.sh
```

Restore must require explicit confirmation when run interactively.

---

# 89. Deployment Documentation

Create:

```text
docs/SYNOLOGY_DEPLOYMENT.md
```

Include:

1. Install Container Manager.
2. Create directory.
3. Copy `compose.yml`.
4. Create `.env`.
5. Create data directories.
6. Start containers.
7. Create first admin.
8. Configure reverse proxy.
9. Configure DNS.
10. Configure Let's Encrypt.
11. Configure firewall.
12. Verify application.
13. Configure backup.
14. Perform test restore.

---

# 90. Developer README

README must provide:

```text
Prerequisites

Local Development

Environment Variables

Database Setup

Run Migrations

Seed Data

Run Web

Run API

Run Worker

Run Tests

Build Production

Docker Compose

Synology Deployment

Backup

Restore

Troubleshooting
```

A new developer or AI coding agent should be able to start the system using README alone.

---

# 91. Initial Seed Data

Development seed should include:

Event:

```text
myDharma Fest 2026
MDF26
```

Categories:

```text
Participant
Volunteer
Satsang
Guest
```

Users:

```text
Admin
Supervisor
Volunteer
```

Registrations should include:

- Single attendee.
- Family of 2.
- Family of 4.
- Duplicate-email warning case.
- Already checked-in example.
- Partially checked-in example.

Do not use real participant data in seed files.

---

# 92. Initial UI Screens

Create these screens first:

```text
Login
Dashboard
Events
Event Overview
Registrations
Import Registrations
Registration Detail
Volunteers
Invitations
Scanner
Participant Search
Reports
Users
Settings
```

---

# 93. Mobile Priority Screens

Highest priority for mobile UX:

1. Login.
2. Scanner.
3. Scan Result.
4. Check-In Confirmation.
5. Participant Search.
6. Recent Check-ins.

Administration screens may optimize for tablet/desktop.

---

# 94. Desktop Priority Screens

Optimize for desktop/tablet:

- Registration import.
- Registration table.
- Invitation management.
- Dashboard.
- Reports.
- Event configuration.
- User management.

---

# 95. Future Google Sheets Integration

Do not implement in V1.

Design imports so a future adapter can support:

```text
Google Forms
      |
Google Sheets
      |
API Sync
      |
Dharma Events
```

The core domain should not depend on Excel.

---

# 96. Future WhatsApp Integration

Do not implement in V1.

Future design should allow invitation delivery through:

```text
Email
WhatsApp
SMS
```

using a delivery-channel abstraction.

---

# 97. Data Retention

Provide event archive capability.

Archived events:

- Remain readable by admins.
- Cannot accept normal check-ins.
- Cannot accidentally send invitations.
- Can still export reports.

Provide manual delete functionality only to admins.

Deletion should require explicit confirmation.

---

# 98. Acceptance Criteria for Production Launch

Production is ready when all items below pass:

- Admin authentication works.
- Volunteer authentication works.
- Current registration file imports correctly.
- Data issues can be reviewed.
- QR codes generate.
- PDF invitations generate.
- SMTP works.
- Bulk invitation queue works.
- Mobile scanning works on iPhone.
- Mobile scanning works on Android.
- Partial check-in works.
- Duplicate check-in protection works.
- Simultaneous scan race condition tested.
- Search works.
- Supervisor override works.
- Check-in reversal works.
- Dashboard reconciles.
- Reports export.
- Audit logs work.
- HTTPS active.
- PostgreSQL not internet-accessible.
- Backup succeeds.
- Restore succeeds.
- Container restart tested.
- NAS restart tested.
- Event simulation completed.

---

# 99. First Autonomous Coding Prompt

Use the following prompt in Copilot CLI / Claude Sonnet after placing this file in the repository:

```text
You are the lead engineer for this project.

Read REQUIREMENTS.md completely before making changes.

Implement Dharma Events as specified.

Start with Phase 0 only.

Requirements:
- Create the monorepo structure.
- Configure pnpm workspaces.
- Create React + TypeScript + Vite web app.
- Create Node + TypeScript + Fastify API.
- Create worker service.
- Create shared packages.
- Configure PostgreSQL in Docker Compose.
- Configure linting, formatting, type checking and tests.
- Create .env.example.
- Create README.md.
- Create docs/ASSUMPTIONS.md.
- Create an implementation checklist in docs/IMPLEMENTATION_STATUS.md.

Do not implement later product features yet.

Run all available checks before finishing.

If a reasonable engineering choice is not specified, choose a secure and simple default and record it in docs/ASSUMPTIONS.md.

At completion, update docs/IMPLEMENTATION_STATUS.md with:
- completed work
- tests executed
- unresolved issues
- next phase

Do not ask for confirmation unless proceeding would be destructive or impossible.
```

---

# 100. Continuous Autonomous Development Prompt

After Phase 0 succeeds, use:

```text
Read REQUIREMENTS.md and docs/IMPLEMENTATION_STATUS.md.

Continue implementation from the next incomplete phase.

Work autonomously.

For the selected phase:
1. Review existing code.
2. Implement all requirements for that phase.
3. Add or update database migrations.
4. Add validation.
5. Add authorization.
6. Add unit and integration tests.
7. Update documentation.
8. Run lint.
9. Run typecheck.
10. Run tests.
11. Fix failures.
12. Update docs/IMPLEMENTATION_STATUS.md.

Do not begin the following phase until the current phase meets its acceptance criteria.

Prefer simple, secure, maintainable solutions.

Do not introduce infrastructure or features excluded by REQUIREMENTS.md.

Do not use real participant information in tests or seed files.

If a reasonable choice is unspecified, make the choice and document it in docs/ASSUMPTIONS.md.

Continue until the current phase is fully complete.
```

---

# 101. Recommended Autonomous Execution Sequence

Run the AI agent repeatedly against the same repository.

Suggested progression:

```text
Phase 0
Repository Bootstrap
        |
        v
Phase 1
Database + Authentication
        |
        v
Phase 2
Events + Volunteers
        |
        v
Phase 3
Registration Import
        |
        v
Phase 4
QR + Invitations
        |
        v
Phase 5
Scanner + Check-In
        |
        v
Phase 6
Supervisor Operations
        |
        v
Phase 7
Dashboard + Reports
        |
        v
Phase 8
Production Hardening
        |
        v
Phase 9
Event Simulation
        |
        v
Production Deployment
```

---

# 102. Final Engineering Objective

The final system should allow an organiser to perform this entire workflow without technical assistance:

```text
Create Event
    |
Import Excel
    |
Review Issues
    |
Generate Invitations
    |
Send QR Emails
    |
Volunteers Login
    |
Scan Participants
    |
Track Attendance
    |
View Dashboard
    |
Export Reports
```

The application must remain simple enough to deploy, operate, back up, and restore from a Synology NAS.

The architecture should prioritize reliability and maintainability over technical complexity.

---

# End of Specification
