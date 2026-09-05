import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers.js';

test.describe('Events', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('the events list loads and shows the seeded E2E fixture event', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'E2E Test Event' })).toBeVisible();
  });

  test('typing multiple characters into a modal form field does not lose focus after each keystroke', async ({
    page,
  }) => {
    // Regression test for the Modal component's focus-effect re-running on
    // every parent re-render (since `onClose` was an inline arrow function,
    // recreated each keystroke) and stealing focus back to the dialog panel.
    await page.getByRole('button', { name: '+ New Event' }).click();
    const nameInput = page.getByLabel('Event name');
    await nameInput.pressSequentially('E2E Typed Event Name', { delay: 30 });
    await expect(nameInput).toHaveValue('E2E Typed Event Name');
  });

  test('a valid event creation succeeds and appears in the list', async ({ page }) => {
    const uniqueCode = `E2E-CREATE-${Date.now()}`;
    await page.getByRole('button', { name: '+ New Event' }).click();
    await page.getByLabel('Event code').fill(uniqueCode);
    await page.getByLabel('Event name').fill('E2E Created Event');
    await page.getByLabel('Event date').fill('2030-06-01');
    await page.getByRole('button', { name: 'Create event' }).click();

    await expect(page.getByRole('link', { name: 'E2E Created Event' })).toBeVisible();
    await expect(page.getByText(uniqueCode)).toBeVisible();
  });

  test('submitting without a required date does not create an event and preserves entered fields', async ({
    page,
  }) => {
    const uniqueCode = `E2E-NODATE-${Date.now()}`;
    await page.getByRole('button', { name: '+ New Event' }).click();
    await page.getByLabel('Event code').fill(uniqueCode);
    await page.getByLabel('Event name').fill('E2E No Date Event');
    // Deliberately leave Event date blank; the input has the native
    // `required` attribute, so the browser blocks submission entirely.
    await page.getByRole('button', { name: 'Create event' }).click();

    await expect(page.getByLabel('Event code')).toHaveValue(uniqueCode);
    await expect(page.getByLabel('Event name')).toHaveValue('E2E No Date Event');
    await expect(page.getByText('E2E No Date Event', { exact: true })).toHaveCount(0);
  });

  test('rapid duplicate submission does not create two events', async ({ page }) => {
    const uniqueCode = `E2E-DUPLICATE-${Date.now()}`;
    await page.getByRole('button', { name: '+ New Event' }).click();
    await page.getByLabel('Event code').fill(uniqueCode);
    await page.getByLabel('Event name').fill('E2E Duplicate Click Event');
    await page.getByLabel('Event date').fill('2030-07-01');

    const button = page.getByRole('button', { name: 'Create event' });
    await Promise.all([button.click(), button.click()]);

    await expect(page.getByRole('link', { name: 'E2E Duplicate Click Event' })).toHaveCount(1);
  });
});
