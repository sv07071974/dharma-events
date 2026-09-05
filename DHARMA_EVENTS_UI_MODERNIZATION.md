# Dharma Events — UI Modernization and Regression-Safe Implementation Specification

## 1. Purpose

Modernize the complete Dharma Events web application while preserving all existing core functionality, data, API contracts, business rules, QR formats, email behavior, check-in calculations, reports, authentication, and authorization.

This document is intended to be given directly to GitHub Copilot CLI or another coding agent working inside the existing repository.

The target application is currently deployed at `https://events.sansmi.org` and is used for event administration, registrations, invitation generation, QR-based check-in, volunteers, dashboards, and reports.

## 2. Primary Instruction to the Coding Agent

Implement the UI modernization incrementally. Do not rewrite the application, change the technology stack, replace working backend services, or alter the database schema during the initial UI phase.

Before modifying code:

1. Inspect the repository structure and identify the frontend framework, backend framework, database layer, API routes, authentication mechanism, email provider, QR implementation, report generation, test framework, Docker configuration, and deployment configuration.
2. Read all repository-level instruction files, including `AGENTS.md`, `README.md`, environment examples, migration files, and deployment notes.
3. Run the existing application and all existing tests.
4. Create a baseline record of routes, API contracts, database schema, workflows, screenshots, and test results.
5. Add regression tests for critical functionality before changing the UI.
6. Make small, reviewable commits grouped by screen or shared component.
7. Run tests after every material change.
8. Stop and report the proposed change before proceeding if a requirement would alter an API contract, database schema, QR payload, email workflow, permission rule, or report calculation.

## 3. Non-Negotiable Preservation Rules

The following must remain compatible unless explicitly approved in a later phase:

- Existing URLs and protected-route behavior.
- Existing database tables, columns, migrations, identifiers, and relationships.
- Existing API paths, request bodies, response bodies, HTTP methods, and status codes.
- Existing login, session, role, and authorization behavior, except for the logout UI fix specified below.
- Existing event statuses and status transitions.
- Existing registration-number generation.
- Existing category and volunteer assignments.
- Existing CSV/XLSX import behavior and accepted file formats.
- Existing invitation PDF generation and category-specific attachments.
- Existing QR-code payload and validation rules.
- Existing email provider, recipient rules, attachments, templates, and delivery logic.
- Existing check-in, partial check-in, remaining-capacity, reversal, and duplicate-prevention rules.
- Existing dashboard calculations.
- Existing CSV/XLSX report content and calculations.
- Existing deployment model for Synology NAS and Docker, if present.

Do not delete, rename, or repurpose existing API fields. UI-friendly derived display values may be added in the frontend without changing stored values.

## 4. Confirmed Existing Functional Areas

Preserve and regression-test these observed functions:

- Admin login and logout.
- Protected event routes.
- Event listing and event creation.
- Event status management: Draft, Active, Completed, and Archived.
- Registration-open and check-in-open controls.
- Event categories.
- Category-specific invitation PDF templates.
- Volunteer creation, assignment, activation/deactivation, and removal.
- Registration search by name, email, telephone number, and registration number.
- Manual registration entry.
- Attendee count, category, and optional volunteer assignment.
- CSV/XLSX registration import with preview.
- Invitation generation, PDF preview, bulk send, resend, and status totals.
- QR scanning.
- Manual participant lookup when a camera is unavailable.
- Full and partial check-in.
- Check-in reversal.
- Recent check-in history.
- Event dashboard totals and percentages.
- Category and volunteer summaries.
- Arrival timeline.
- Attendance, no-show, check-in, and invitation reports in CSV and XLSX.

## 5. Findings from Live UI Testing

### 5.1 High Priority

#### Logout leaves protected information visible

The server-side session is invalidated and subsequent protected navigation redirects to login, but the current protected screen remains visible after selecting Log out.

Required fix:

- Clear user/session state immediately.
- Clear sensitive cached query data.
- Navigate immediately to `/login` using history replacement.
- Ensure the browser Back button cannot reveal usable protected content.
- Confirm that protected API requests return an unauthorized response after logout.

### 5.2 Medium Priority

#### Raw event dates

Dates are displayed as raw timestamps such as `2026-10-04T00:00:00.000Z`.

Required fix:

- Display dates as `04 Oct 2026` or `4 October 2026`.
- Preserve the stored date value.
- Use one clearly defined event timezone.
- Validate unreasonable dates and years.
- Display a clear inline error when date input is invalid.

#### Registration management gap

The registration table does not expose a clear individual View/Edit action.

Initial UI-phase requirement:

- Add a View action or clickable registration number using existing data and APIs.
- If editing, cancellation, or deletion is not already supported by the backend, display those as future features; do not invent new API calls in Phase 1.

#### High-impact actions need safeguards

Add meaningful confirmation dialogs before any existing high-impact action:

- Send All Ready.
- Resend invitation.
- Reverse check-in.
- Remove or replace invitation template.
- Deactivate or delete volunteer.
- Close registration.
- Close check-in.
- Change event to Completed or Archived.

The dialog must describe the exact impact and affected record count where available.

### 5.3 Verification Required

- Verify every CSV and XLSX report downloads correctly and opens without repair warnings.
- Verify invitation PDFs and appended category templates.
- Verify QR scanning using real iPad/iPhone and Android cameras.
- Verify portrait and landscape layouts on iPad.
- Verify mobile behavior on slow or intermittent connectivity.

## 6. Target Information Architecture

### 6.1 Desktop Navigation

Use a consistent application shell with:

- Dashboard.
- Events.
- Registrations.
- Invitations.
- Check-in.
- Reports.
- Volunteers.
- Settings.

The top bar should show:

- Current event selector.
- Event date and status.
- Current user and role.
- Logout.

Do not show event-scoped navigation until an event is selected.

### 6.2 Mobile and iPad Navigation

Use a compact bottom navigation where appropriate:

- Dashboard.
- Guests.
- Scan.
- Reports.
- More.

The Scan action should be visually prominent for volunteer users. Respect iOS safe areas and support portrait and landscape orientation.

## 7. Design System

Create reusable components rather than page-specific styling.

### 7.1 Visual Direction

- Primary: deep indigo.
- Accent: restrained saffron or warm gold.
- Success: green.
- Warning: amber.
- Error: red.
- Background: warm off-white or very light neutral.
- Text: dark charcoal.

Maintain accessible contrast. Status must never be communicated by color alone; include readable text and, where appropriate, an icon.

### 7.2 Shared Components

Implement or standardize:

- App shell and navigation.
- Page header.
- Buttons and icon buttons.
- Form fields and validation messages.
- Status badges.
- Summary cards.
- Responsive data table.
- Mobile record cards.
- Confirmation dialog.
- Side panel/drawer.
- Toast notification.
- Empty state.
- Loading skeleton.
- Error state with retry.
- Search and filter bar.
- Pagination.
- File-upload panel.

### 7.3 Accessibility

- Every input must have a programmatically associated label.
- Every icon-only control must have an accessible name.
- All actions must be keyboard accessible.
- Show a clear focus indicator.
- Use semantic headings and landmarks.
- Meet WCAG 2.1 AA contrast expectations.
- Use live regions for important scan, upload, email, and validation feedback.
- Do not rely only on color, hover, or animation.
- Respect reduced-motion preferences.

## 8. Screen-by-Screen Requirements

### 8.1 Login

- Retain current email/password login behavior.
- Add show/hide password.
- Add clear invalid-login feedback without exposing technical details.
- Add loading state and prevent duplicate submissions.
- Preserve the clean centered-card layout.
- Optimize spacing for iPad and mobile.
- Redirect authenticated users away from `/login`.
- Implement the logout fix in Section 5.1.

### 8.2 Events

- Add a clear `+ New Event` primary action.
- Move the creation form into a modal, drawer, or dedicated route.
- Keep the current creation API unchanged.
- Display friendly dates.
- Add search, status filters, and sorting.
- Show useful event summary information when already available.
- Provide an overflow action menu for supported actions.
- Use a table on desktop and cards on narrow screens.
- Do not add Delete, Duplicate, or Edit actions unless supported by existing APIs.

Recommended columns:

| Event | Code | Date | Status | Registrations | Attendance | Actions |
|---|---|---|---|---:|---:|---|

### 8.3 Create Event

Phase 1 should modernize the existing fields without changing the API:

- Event code.
- Event name.
- Event date.

Requirements:

- Use reliable date entry and a graphical date picker.
- Show the expected date format.
- Validate before submitting.
- Retain values when validation fails.
- Disable duplicate submission.
- Show success feedback and open the created event.

Venue, times, description, capacity, and multi-step creation are Phase 3 unless already supported by the backend.

### 8.4 Event Overview

Create a clear event header showing:

- Event name.
- Friendly date.
- Status badge.
- Registration-open state.
- Check-in-open state.

Use tabs:

- Overview.
- Registrations.
- Invitations.
- Check-in.
- Volunteers.
- Reports.
- Settings.

Use existing data to show summary cards where available:

- Registrations.
- Expected attendees.
- Invitations sent.
- Arrived.
- Remaining.
- Attendance percentage.

Move categories, templates, volunteers, and event controls into clearly labelled sections. Do not mix destructive actions with routine information.

### 8.5 Registrations

Recommended columns:

| Registration | Participant | Contact | Category | Guests | Invitation | Check-in | Actions |
|---|---|---|---|---:|---|---|---|

Requirements:

- Search as the user types, with an optional explicit Search action if required by the current API.
- Preserve search by name, email, phone, and registration number.
- Add filters using existing fields.
- Add sorting where it can be performed safely.
- Add pagination when record volume requires it.
- Use a sticky header on desktop.
- Convert each row to a readable card on mobile.
- Provide a View action using existing data.
- Preserve manual registration entry.
- Prevent repeated clicks while saving.
- Display success or specific validation errors.
- Mask contact data where the current role does not need the full value.

Do not implement new Edit, Cancel, or Delete behavior in Phase 1 unless corresponding authorized backend APIs already exist.

### 8.6 Registration Import

Present the existing process as a step-by-step experience:

1. Download template.
2. Select CSV/XLSX file.
3. Preview and validate.
4. Confirm import.
5. Display results.

Classify preview rows where the current backend provides sufficient information:

- Ready.
- Duplicate.
- Missing required data.
- Invalid email.
- Invalid phone.
- Unknown category.
- Unknown volunteer.

Do not change import parsing or validation business rules in the initial UI release.

### 8.7 Invitations

Display a clear status summary:

- Total.
- Not generated.
- Ready.
- Sent.
- Failed.

Requirements:

- Preserve Generate Invitations, Send All Ready, Preview PDF, and Resend.
- Add confirmation before Send All Ready and Resend.
- Show the number of recipients before bulk send.
- Disable controls and show progress during generation or sending.
- Show useful success and failure feedback.
- Keep recipient email addresses protected from unnecessary display.
- Preserve PDF attachments and category-specific templates.
- Do not claim Delivered or Bounced unless the backend actually supplies those states.

### 8.8 Scanner and Check-In

This screen must prioritize speed, clarity, and large touch targets.

Requirements:

- Large Start/Scan QR action.
- Clear camera area and camera-permission guidance.
- Maintain manual participant search.
- Maintain camera-unavailable fallback.
- Display participant name, registration number, category, registered count, already arrived, remaining, and arriving now.
- Preserve partial check-in.
- Use a large Check In button.
- Prevent duplicate submissions.
- Give strong result feedback:
  - Green: successful check-in.
  - Amber: partial or already partially checked in.
  - Red: invalid ticket or failure.
  - Blue/information: already checked in.
- Add sound/vibration only where supported and user-appropriate.
- Preserve Reverse with a confirmation dialog.
- Show who performed the original check-in and its timestamp when available.

Offline scanning is not part of Phase 1. Do not introduce it without a separate data-synchronization design.

### 8.9 Dashboard

Prioritize:

- Expected attendees.
- Arrived.
- Remaining.
- Attendance percentage.

Use existing data for:

- Attendance over time.
- Attendance by category.
- Check-ins by volunteer/counter.
- Recent check-ins.

Requirements:

- Maintain exact existing calculations.
- Add useful empty states.
- Avoid misleading charts for very small datasets.
- Refresh data safely without duplicate requests.
- Show the last refreshed time if automatic refresh exists.

### 8.10 Reports

Replace the plain list of links with report cards while preserving the endpoints.

Reports:

- Attendance.
- No-show.
- Check-in transactions.
- Invitation delivery.

Each card should include:

- Short description.
- CSV download.
- XLSX download.
- Loading/failure feedback.

Use friendly downloaded filenames when this can be done without changing report contents or breaking clients.

### 8.11 Volunteers

- Present volunteers in a dedicated section or tab.
- Show name, role/duty, active state, and safe contact details.
- Preserve existing create, deactivate, and delete functions.
- Put Deactivate and Delete inside an action menu.
- Require confirmation.
- Clearly distinguish inactive users.
- Do not expand permissions or expose additional events.

### 8.12 Settings and Templates

Separate settings into:

- Event status and availability.
- Categories.
- Invitation attachment.
- Category templates.
- Volunteers or access, depending on existing architecture.

For uploaded templates, show:

- Filename.
- Category using the template.
- View action.
- Replace action.
- Remove action with confirmation.

Do not change the file type, size rules, upload endpoints, or PDF-merging logic in Phase 1.

## 9. Responsive Requirements

Test at minimum:

- 375 × 812 mobile portrait.
- 390 × 844 mobile portrait.
- 768 × 1024 iPad portrait.
- 1024 × 768 iPad landscape.
- 1366 × 768 desktop.
- 1440 × 900 desktop.

Acceptance requirements:

- No page-level horizontal scrolling.
- Tables convert to cards or use a deliberately contained horizontal scroller.
- Primary actions remain visible and reachable.
- Touch targets are at least approximately 44 × 44 CSS pixels.
- Forms do not cause unintended zoom on iOS.
- Dialogs fit within the viewport.
- Safe-area insets are respected.
- Scanner controls are usable with one hand.

## 10. Security and Privacy Requirements

- Fix logout behavior as specified.
- Do not log passwords, QR payloads, session tokens, or personal data.
- Preserve server-side authorization checks.
- UI hiding is not authorization.
- Protect report and invitation endpoints with the existing authorization mechanism.
- Avoid exposing participant emails and phone numbers unnecessarily.
- Sanitize displayed values according to the framework's safe defaults.
- Do not inject HTML from imported registration data.
- Maintain CSRF protection where applicable.
- Do not store authentication tokens in a less secure location during the redesign.
- Do not add third-party trackers or analytics without explicit approval.

## 11. Performance Requirements

- Avoid loading all records when pagination or server filtering exists.
- Debounce type-ahead search.
- Avoid duplicate API calls caused by rendering.
- Lazy-load heavy scanner/PDF functionality where practical.
- Provide skeletons or progress indicators for perceptible waits.
- Keep the core scanner path fast on event Wi-Fi.
- Do not introduce a large UI library without assessing bundle impact and compatibility.

## 12. Error and Feedback Standards

Every asynchronous action must have:

- Ready state.
- In-progress state.
- Success state.
- Actionable failure state.
- Duplicate-submission protection.

Messages should be written for event administrators and volunteers, not developers.

Examples:

- Good: `Invitation could not be sent. Check the email address and try again.`
- Avoid: `HTTP 500` or raw stack traces.

## 13. Regression Test Requirements

Use the repository's existing test tools. If Playwright is already present, extend it. If no end-to-end tool exists, propose Playwright separately before adding dependencies.

### 13.1 Authentication

- Valid admin login succeeds.
- Invalid login displays safe feedback.
- Protected route redirects when logged out.
- Logout invalidates the session.
- Logout immediately clears protected content.
- Back navigation after logout does not restore usable protected state.

### 13.2 Events

- Event list loads.
- Event dates display correctly.
- Valid event creation succeeds.
- Invalid or missing date is rejected without clearing other fields.
- Duplicate submission does not create two events.
- Existing event routes still open.

### 13.3 Registrations

- Existing registrations load.
- Search works for each supported identifier.
- Manual registration creates exactly one record.
- Attendee count, category, and volunteer are preserved.
- Invalid inputs display appropriate feedback.
- Import preview does not commit data.
- Confirmed import creates the expected number of records.

### 13.4 Invitations

- Invitation generation produces a PDF for eligible registrations.
- Category attachment remains appended correctly.
- Bulk send shows an accurate recipient count.
- Cancelling confirmation sends nothing.
- Confirmed send executes once.
- Resend affects only the selected registration.
- Failed sends display without corrupting status totals.

Use a test email provider, sandbox mode, or controlled test inboxes. Never send automated regression emails to real participants.

### 13.5 QR and Check-In

- Valid QR resolves to the correct registration.
- Invalid QR is rejected.
- Wrong-event QR is rejected if that is the current rule.
- Manual lookup works.
- Full check-in records the correct count.
- Partial check-in records the selected count.
- Remaining capacity is correct.
- Duplicate check-in is prevented or clearly handled.
- Reversal restores the correct totals.
- Dashboard totals match check-in transactions.

### 13.6 Reports

- All CSV and XLSX endpoints remain available.
- Files are non-empty and open successfully.
- Report headers remain compatible.
- Totals match the dashboard and database test fixtures.
- Phone numbers retain country codes and plus signs.
- Names with commas, apostrophes, Unicode, and other special characters export correctly.

### 13.7 Accessibility and Responsive Layout

- Automated accessibility scan on key pages.
- Keyboard navigation for all primary workflows.
- No serious accessible-name or contrast failures.
- No horizontal page overflow at required viewports.
- Scanner and check-in controls meet touch-target requirements.

## 14. Test Data Rules

- Use a dedicated test event, not a production event.
- Prefix test entities clearly, such as `E2E Test Event`.
- Use controlled email aliases belonging to the application owner.
- Never use real participant email addresses for automated tests.
- Do not send emails unless the test provider or destination has been explicitly approved.
- Clean up test data only through safe, supported application/API behavior.
- Never run destructive cleanup against an unverified environment.

## 15. Implementation Phases

### Phase 0 — Baseline and Protection

- Inventory routes, APIs, schema, roles, and workflows.
- Run current tests.
- Capture baseline screenshots.
- Add critical happy-path regression tests.
- Document current build and deployment commands.

### Phase 1 — Low-Risk UI Modernization

- Shared design tokens and components.
- Application navigation shell.
- Responsive layouts.
- Friendly date display.
- Improved forms, tables, cards, loading, empty, and error states.
- Scanner presentation improvements.
- No API or schema changes.

### Phase 2 — Safety and Workflow Clarity

- Logout redirect/cache fix.
- Confirmation dialogs.
- Registration detail view using existing APIs.
- Invitation preview improvements.
- Guided import presentation.
- Report cards.

### Phase 3 — Separately Approved Enhancements

Do not begin without explicit approval:

- Registration edit, cancellation, and deletion APIs.
- Offline check-in and synchronization.
- Email delivery/bounce tracking.
- New role and permission model.
- Audit logging.
- WhatsApp delivery.
- Self-service public registration.
- Additional event fields or schema changes.

## 16. Deployment and Rollback

- Work on a dedicated feature branch.
- Preserve production deployment configuration.
- Never point development tests at the production database without explicit approval.
- Build and test the Docker image if Docker is used.
- Deploy first to a beta/staging route, preferably `events.sansmi.org/beta` or an equivalent isolated environment.
- Use a separate test database or safely anonymized copy.
- Run smoke tests after deployment.
- Compare dashboard and report totals with the baseline.
- Keep the current production image/version available for immediate rollback.
- Do not deploy to production automatically unless explicitly instructed.

## 17. Definition of Done for the Initial Modernization

The initial UI modernization is complete only when:

- All existing automated tests pass.
- New critical workflow tests pass.
- No API contract or database schema has changed.
- Existing QR codes still validate.
- Existing invitation generation and email behavior remain compatible.
- Dashboard and report totals match the baseline.
- Logout clears protected content immediately.
- Key pages work at all required viewport sizes.
- No serious accessibility failures remain.
- No new browser-console application errors appear.
- Production build and deployment artifacts succeed.
- Rollback instructions have been verified.
- A change summary and residual-risk report are provided.

## 18. Required Agent Deliverables

For every implementation phase, produce:

1. Repository assessment.
2. Baseline test results.
3. Files changed.
4. Explanation of each material change.
5. Tests added or updated.
6. Test execution results.
7. Screenshots at desktop, mobile, and iPad sizes.
8. Accessibility findings.
9. Known limitations.
10. Deployment instructions.
11. Rollback instructions.
12. Confirmation that APIs, schema, QR payloads, email behavior, calculations, and report content were preserved.

## 19. Suggested Initial Copilot CLI Prompt

Use this prompt after placing this file in the repository root:

```text
Read DHARMA_EVENTS_UI_MODERNIZATION.md completely and treat it as the governing implementation specification.

Start with Phase 0 only. Inspect the repository, identify the architecture and existing functionality, run the current application and tests, inventory routes/APIs/schema/business rules, and create a regression-safe implementation plan.

Do not modify production code yet. Do not change the database schema, API contracts, QR format, email workflow, authentication, permissions, calculations, reports, dependencies, or deployment configuration. Identify any repository instructions such as AGENTS.md and follow them.

Return:
1. architecture summary;
2. current route and API inventory;
3. existing test coverage and gaps;
4. proposed Phase 1 file-by-file changes;
5. risks and preservation controls;
6. commands for baseline tests;
7. questions that genuinely block safe implementation.

Wait for approval before starting Phase 1.
```

## 20. Final Instruction

Treat preservation of working event operations as more important than visual redesign speed. If a UI improvement risks changing existing behavior, keep the current behavior, document the limitation, and request approval for a separate enhancement.
