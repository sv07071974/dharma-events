import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { FIXTURES_PATH, type E2eFixtures } from '../global-setup.js';

export function readFixtures(): E2eFixtures {
  return JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf-8')) as E2eFixtures;
}

/** Logs in through the real login form (Section 13.1) rather than seeding a session directly. */
export async function loginAsAdmin(page: Page): Promise<void> {
  const { adminEmail, adminPassword } = readFixtures();
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/events');
}
