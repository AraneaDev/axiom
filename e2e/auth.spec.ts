import { test, expect } from '@playwright/test';
import { login, logout, DEMO_USERS } from './helpers';

test.describe('Authentication', () => {
  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Admin User')).toBeVisible();
  });

  test('login with wrong password shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or username').fill('admin');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/invalid email\/username or password/i)).toBeVisible();
  });

  test('login with email works', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or username').fill('admin@axiom.local');
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');
  });

  test('authenticated pages redirect to login when logged out', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });

  test('login as different users', async ({ page }) => {
    for (const user of [DEMO_USERS.sarah, DEMO_USERS.marcus]) {
      await login(page, user);
      await expect(page.getByText(user.display)).toBeVisible();
      await logout(page);
    }
  });

  test('logout clears session and redirects to login', async ({ page }) => {
    await login(page);
    await logout(page);
    await expect(page).toHaveURL('/login');
    // Navigating to protected route should redirect back to login
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });
});
