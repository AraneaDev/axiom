import { type Page } from '@playwright/test';

export const DEMO_USERS = {
  admin: { login: 'admin', password: 'password123', display: 'Admin User' },
  sarah: { login: 'sarah-chen', password: 'password123', display: 'Sarah Chen' },
  marcus: { login: 'marcus-kim', password: 'password123', display: 'Marcus Kim' },
};

export const BASE = 'http://localhost:7000';
export const ORG = 'axiom';

/** Log in and land on the dashboard. */
export async function login(page: Page, user = DEMO_USERS.admin) {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(user.login);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait for redirect away from /login (may land on '/' or '/axiom' depending on state)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

/** Log out via the header user menu. */
export async function logout(page: Page) {
  await page.getByRole('button', { name: /admin user|sarah chen|marcus kim/i }).first().click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('/login');
}
