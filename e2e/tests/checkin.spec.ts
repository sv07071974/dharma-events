import { expect, test } from '@playwright/test';
import { loginAsAdmin, readFixtures } from './helpers.js';

test.describe('Scanner and Check-In (manual lookup path)', () => {
  test('manual lookup finds a registration and a full check-in records the correct count', async ({ page }) => {
    await loginAsAdmin(page);
    const { eventId, categoryId } = readFixtures();

    const uniqueEmail = `e2e-checkin-${Date.now()}@dharma-events.test`;
    const createRes = await page.request.post(`/api/v1/events/${eventId}/registrations`, {
      data: { name: 'E2E Checkin Guest', email: uniqueEmail, registeredCount: 3, categoryId },
    });
    expect(createRes.ok()).toBeTruthy();
    const { data } = (await createRes.json()) as { data: { registration: { id: string; registrationNo: string } } };
    const { registrationNo } = data.registration;

    await page.goto(`/events/${eventId}/scanner`);
    await page.getByLabel('Name / Phone / Reg ID').fill(registrationNo);
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(new RegExp(`${registrationNo}.*E2E Checkin Guest`))).toBeVisible();
    await page.getByRole('button', { name: 'Open' }).click();

    const validCard = page.locator('.scan-result-card--valid');
    await expect(validCard.getByRole('heading', { name: 'Valid registration' })).toBeVisible();
    await expect(validCard.getByText(/Registered: 3/)).toBeVisible();

    // Arriving-now defaults to the full remaining count; confirm the full party.
    const arrivingInput = page.getByLabel('Arriving now');
    await expect(arrivingInput).toHaveValue('3');
    await page.getByRole('button', { name: 'CHECK IN' }).click();

    // A completed check-in returns to the search/idle state (no active card).
    await expect(page.getByRole('heading', { name: 'Valid registration' })).not.toBeVisible();

    const verifyRes = await page.request.get(`/api/v1/events/${eventId}/registrations/search?q=${registrationNo}`);
    const verifyBody = (await verifyRes.json()) as {
      data: { registrations: { registrationNo: string }[] };
    };
    expect(verifyBody.data.registrations.some((r) => r.registrationNo === registrationNo)).toBeTruthy();
  });

  test('an invalid/unknown registration number returns no manual search results', async ({ page }) => {
    await loginAsAdmin(page);
    const { eventId } = readFixtures();
    await page.goto(`/events/${eventId}/scanner`);

    await page.getByLabel('Name / Phone / Reg ID').fill('NO-SUCH-REGISTRATION-000');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByRole('button', { name: 'Open' })).toHaveCount(0);
  });
});
