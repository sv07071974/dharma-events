import { expect, test } from '@playwright/test';
import { readFixtures } from './helpers.js';

/**
 * Phase 3 (explicitly approved) - restricted "check-in + dashboard only"
 * login for event-day VOLUNTEER staff. VOLUNTEER already only ever had
 * Check-in-relevant API access server-side for the full registrant
 * list/detail endpoints (tightened alongside this feature - see
 * apps/api/src/routes/registrations.ts); this spec covers the frontend nav
 * restriction, the Overview auto-redirect, and the backend 403s together.
 */
test.describe('Restricted VOLUNTEER role (check-in only)', () => {
  const uniqueSuffix = Date.now();
  const volunteerEmail = `e2e-checkin-volunteer-${uniqueSuffix}@dharma-events.test`;
  const volunteerPassword = 'E2E-volunteer-password-123!';

  test.beforeAll(async ({ browser }) => {
    const { adminEmail, adminPassword } = readFixtures();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByLabel('Password', { exact: true }).fill(adminPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/events');

    const createRes = await page.request.post('/api/v1/users', {
      data: {
        email: volunteerEmail,
        name: 'E2E Checkin Volunteer',
        password: volunteerPassword,
        role: 'VOLUNTEER',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(volunteerEmail);
    await page.getByLabel('Password', { exact: true }).fill(volunteerPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/events');
  });

  test('event nav shows only Check-in (no Overview/Registrations/Invitations/Dashboard)', async ({ page }) => {
    const { eventId } = readFixtures();
    await page.goto(`/events/${eventId}/scanner`);

    const eventNav = page.getByRole('navigation', { name: 'Event sections' });
    await expect(eventNav.getByRole('link', { name: 'Check-in' })).toBeVisible();
    await expect(eventNav.getByRole('link', { name: 'Overview' })).toHaveCount(0);
    await expect(eventNav.getByRole('link', { name: 'Registrations' })).toHaveCount(0);
    await expect(eventNav.getByRole('link', { name: 'Invitations' })).toHaveCount(0);
    await expect(eventNav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);

    // Top nav "Manage Events" (ADMIN-only) must also stay hidden.
    await expect(page.getByRole('link', { name: 'Manage Events' })).toHaveCount(0);
  });

  test('navigating directly to the Overview URL redirects straight to Check-in', async ({ page }) => {
    const { eventId } = readFixtures();
    await page.goto(`/events/${eventId}`);
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}/scanner$`));
  });

  test('the Registrations and Invitations pages show a permission message, not their content', async ({ page }) => {
    const { eventId } = readFixtures();
    await page.goto(`/events/${eventId}/registrations`);
    await expect(page.getByText('You do not have permission to view this page.')).toBeVisible();

    await page.goto(`/events/${eventId}/invitations`);
    await expect(page.getByText('You do not have permission to view this page.')).toBeVisible();
  });

  test('backend rejects the full registration list/detail endpoints for this role (403)', async ({ page }) => {
    const { eventId } = readFixtures();
    const listRes = await page.request.get(`/api/v1/events/${eventId}/registrations`);
    expect(listRes.status()).toBe(403);
  });
});
