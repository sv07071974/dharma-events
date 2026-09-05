import { expect, test } from '@playwright/test';
import { loginAsAdmin, readFixtures } from './helpers.js';

/**
 * The worker (which actually renders the ticket PDF and sends email) is
 * intentionally not started for E2E - see global-setup.ts - so these tests
 * cover the UI-driven workflow up to "queued for send" (NOT_SENT -> PENDING).
 * Actual PDF rendering and SMTP delivery already have dedicated coverage in
 * `apps/worker`'s Vitest suite using a FakeMailer, per Section 14's rule to
 * never send real email during automated tests.
 */
test.describe('Invitations', () => {
  test('generating invitations moves an eligible registration from Ready to Pending', async ({ page }) => {
    await loginAsAdmin(page);
    const { eventId, categoryId } = readFixtures();

    const uniqueEmail = `e2e-invite-${Date.now()}@dharma-events.test`;
    const createRes = await page.request.post(`/api/v1/events/${eventId}/registrations`, {
      data: { name: 'E2E Invite Guest', email: uniqueEmail, registeredCount: 1, categoryId },
    });
    expect(createRes.ok()).toBeTruthy();
    const { data } = (await createRes.json()) as { data: { registration: { id: string; registrationNo: string } } };

    await page.goto(`/events/${eventId}/invitations`);
    const row = page.locator('tr', { hasText: data.registration.registrationNo });
    await expect(row).toContainText('NOT_SENT');

    await page.getByRole('button', { name: 'Generate Invitations' }).click();

    await expect(row).toContainText('PENDING');
  });

  test('Send All Ready does not affect the Failed count when there is nothing new to send', async ({ page }) => {
    await loginAsAdmin(page);
    const { eventId } = readFixtures();
    await page.goto(`/events/${eventId}/invitations`);

    const failedStat = page.locator('.stat-card', { hasText: 'Failed' });
    const failedBefore = await failedStat.textContent();

    await page.getByRole('button', { name: 'Send All Ready' }).click();
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    await expect(failedStat).toHaveText(failedBefore ?? '');
  });
});
