import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers.js';

/**
 * Phase 3 (explicitly approved) - Admin-only "Manage Events" cleanup
 * screen. Covers the permanent hard-delete flow added alongside
 * `DELETE /api/v1/events/:eventId?hard=true`.
 */
test.describe('Manage Events (admin cleanup)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('the Manage Events link is visible to an admin and lists all events', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Manage Events' })).toBeVisible();
    await page.getByRole('link', { name: 'Manage Events' }).click();
    await expect(page).toHaveURL(/\/admin\/events$/);
    await expect(page.getByRole('heading', { name: 'Manage Events' })).toBeVisible();
    await expect(page.getByText('E2E Test Event')).toBeVisible();
  });

  test('delete button stays disabled until the exact event code is typed, then permanently removes the event', async ({
    page,
  }) => {
    const uniqueCode = `E2E-DELETE-${Date.now()}`;
    const createRes = await page.request.post('/api/v1/events', {
      data: { eventCode: uniqueCode, eventName: 'E2E Deletable Event', eventDate: '2030-08-01' },
    });
    expect(createRes.ok()).toBeTruthy();

    await page.goto('/admin/events');
    const row = page.locator('tr', { hasText: uniqueCode });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete permanently' }).click();

    const dialog = page.getByRole('dialog', { name: 'Delete event permanently' });
    await expect(dialog).toBeVisible();
    const confirmButton = dialog.getByRole('button', { name: 'Delete permanently' });
    await expect(confirmButton).toBeDisabled();

    await dialog.getByLabel(/Type the event code/).fill('wrong-code');
    await expect(confirmButton).toBeDisabled();

    await dialog.getByLabel(/Type the event code/).fill(uniqueCode);
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(dialog).not.toBeVisible();
    await expect(page.locator('tr', { hasText: uniqueCode })).toHaveCount(0);

    // Confirm it's really gone (not just hidden), via the API too.
    const listRes = await page.request.get('/api/v1/events');
    const { data } = (await listRes.json()) as { data: { events: { eventCode: string }[] } };
    expect(data.events.some((e) => e.eventCode === uniqueCode)).toBe(false);
  });
});
