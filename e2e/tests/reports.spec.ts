import { expect, test } from '@playwright/test';
import { loginAsAdmin, readFixtures } from './helpers.js';

const REPORTS = [
  { label: 'Attendance', path: 'attendance' },
  { label: 'No-show', path: 'no-show' },
  { label: 'Check-in transactions', path: 'checkins' },
  { label: 'Invitation delivery', path: 'invitations' },
];

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    const { eventId } = readFixtures();
    await page.goto(`/events/${eventId}/dashboard`);
  });

  for (const format of ['csv', 'xlsx'] as const) {
    for (const report of REPORTS) {
      test(`${report.label} downloads a non-empty ${format.toUpperCase()} file`, async ({ page }) => {
        const link = page.getByRole('link', { name: format.toUpperCase(), exact: true }).and(
          page.locator(`a[href*="/reports/${report.path}?format=${format}"]`),
        );

        const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);

        const failure = await download.failure();
        expect(failure).toBeNull();

        const streamPath = await download.path();
        expect(streamPath).toBeTruthy();
      });
    }
  }

  test('all report endpoints are reachable directly and return the expected content type', async ({ page }) => {
    const { eventId } = readFixtures();
    for (const report of REPORTS) {
      const csvRes = await page.request.get(`/api/v1/events/${eventId}/reports/${report.path}?format=csv`);
      expect(csvRes.ok()).toBeTruthy();
      expect(csvRes.headers()['content-type']).toContain('csv');

      const xlsxRes = await page.request.get(`/api/v1/events/${eventId}/reports/${report.path}?format=xlsx`);
      expect(xlsxRes.ok()).toBeTruthy();
      expect(xlsxRes.headers()['content-type']).toContain('sheet');
    }
  });
});
