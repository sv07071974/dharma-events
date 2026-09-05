import { expect, test } from '@playwright/test';
import { loginAsAdmin, readFixtures } from './helpers.js';

/**
 * Section 13.1 - Authentication regression coverage.
 *
 * Note on the "logout leaves protected content visible" issue from
 * DHARMA_EVENTS_UI_MODERNIZATION.md Section 5.1: this suite's "immediate
 * clear + back-navigation" test below actually passes against this dev
 * harness (React Query's cache update reactively redirects `ProtectedLayout`
 * fast enough here, and no service worker is registered by Vite's dev
 * server). That means the bug the customer observed in production is most
 * likely a service-worker/back-forward-cache interaction specific to the
 * built PWA, not a missing `navigate()` call - this needs the manual device
 * verification in Section 5.3 in addition to this automated check, and the
 * Phase 2 fix should address both the explicit navigation *and* a
 * `pageshow`/bfcache guard.
 */
test.describe('Authentication', () => {
  test('valid admin login succeeds and reaches the Events page', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/events$/);
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  });

  test('invalid login shows safe feedback without technical details', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@dharma-events.test');
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/50\d|stack|prisma|internal/i);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('an unauthenticated user is redirected away from a protected route', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/events');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logout invalidates the server session (protected API calls become unauthorized)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    const { eventId } = readFixtures();
    const res = await page.request.get(`/api/v1/events/${eventId}/registrations`);
    expect(res.status()).toBe(401);
  });

  test('logout immediately clears protected content and blocks back-navigation to it', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Events' })).not.toBeVisible({ timeout: 50 });
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Events' })).not.toBeVisible();
  });
});
