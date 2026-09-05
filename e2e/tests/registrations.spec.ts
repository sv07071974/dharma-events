import { expect, test } from '@playwright/test';
import { loginAsAdmin, readFixtures } from './helpers.js';

test.describe('Registrations', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    const { eventId } = readFixtures();
    await page.goto(`/events/${eventId}/registrations`);
  });

  test('manual registration creates exactly one record with the entered details', async ({ page }) => {
    const uniqueEmail = `e2e-guest-${Date.now()}@dharma-events.test`;

    await page.getByLabel('Name', { exact: true }).fill('E2E Test Guest');
    await page.getByLabel('Email', { exact: true }).fill(uniqueEmail);
    await page.getByLabel('Attendee count').fill('2');
    await page.getByLabel('Category').selectOption({ label: 'General' });
    await page.getByRole('button', { name: 'Add registration' }).click();

    const row = page.locator('tr', { hasText: uniqueEmail });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('E2E Test Guest');
    await expect(row).toContainText('2');
  });

  test('search finds a registration by email', async ({ page }) => {
    const uniqueEmail = `e2e-search-${Date.now()}@dharma-events.test`;
    await page.getByLabel('Name', { exact: true }).fill('E2E Search Target');
    await page.getByLabel('Email', { exact: true }).fill(uniqueEmail);
    await page.getByLabel('Attendee count').fill('1');
    await page.getByLabel('Category').selectOption({ label: 'General' });
    await page.getByRole('button', { name: 'Add registration' }).click();
    await expect(page.locator('tr', { hasText: uniqueEmail })).toHaveCount(1);

    await page.getByLabel('Search (name / email / phone / reg #)').fill(uniqueEmail);
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('E2E Search Target');
  });

  test('invalid input (missing required category) shows feedback and does not create a record', async ({
    page,
  }) => {
    const uniqueEmail = `e2e-novalid-${Date.now()}@dharma-events.test`;
    await page.getByLabel('Name', { exact: true }).fill('E2E No Category');
    await page.getByLabel('Email', { exact: true }).fill(uniqueEmail);
    await page.getByLabel('Attendee count').fill('1');
    // Category select has the native `required` attribute and is left unset.
    await page.getByRole('button', { name: 'Add registration' }).click();

    await expect(page.locator('tr', { hasText: uniqueEmail })).toHaveCount(0);
  });
});
