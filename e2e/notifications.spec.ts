import { test, expect } from '@playwright/test';

import { DEMO_USERS, login, ORG } from './helpers';

const NOTIFICATIONS_URL = '/notifications';

test.describe('Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USERS.admin);
  });

  test('notification bell icon is visible in the header', async ({ page }) => {
    await page.goto(`/${ORG}`);
    // The NotificationCenter renders a button with title="Notifications" containing a Bell icon
    await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('clicking the bell opens the notification dropdown', async ({ page }) => {
    await page.goto(`/${ORG}`);
    const bellButton = page.getByRole('button', { name: 'Notifications' });
    await expect(bellButton).toBeVisible({ timeout: 10_000 });
    await bellButton.click();

    // Dropdown header shows "Notifications" heading
    await expect(page.getByText('Notifications').first()).toBeVisible({ timeout: 5_000 });

    // Dropdown footer link to full inbox is rendered
    await expect(page.getByRole('link', { name: /view all notifications/i })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('notification inbox page loads at /notifications', async ({ page }) => {
    await page.goto(NOTIFICATIONS_URL);
    // Full-page heading
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Filter tabs should be present
    await expect(page.getByRole('tab', { name: 'All' })).toBeVisible({
      timeout: 10_000,
    });

    // "Mark all as read" button should be present
    await expect(page.getByRole('button', { name: /mark all as read/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('notification inbox filter tabs switch correctly', async ({ page }) => {
    await page.goto(NOTIFICATIONS_URL);
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Click the "Unread" tab
    const unreadTab = page.getByText('Unread').first();
    await expect(unreadTab).toBeVisible({ timeout: 10_000 });
    await unreadTab.click();

    // Page should either show unread notifications or the "All caught up" empty state
    await expect(
      page.getByText(/all caught up/i).or(page.getByText(/no unread notifications/i)).or(
        page.locator('[class*="bg-primary-light"]').first(),
      ),
    ).toBeVisible({ timeout: 10_000 });

    // Switch back to All tab
    await page.getByText('All').first().click();
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('view all notifications link navigates to /notifications', async ({ page }) => {
    await page.goto(`/${ORG}`);
    const bellButton = page.getByRole('button', { name: 'Notifications' });
    await expect(bellButton).toBeVisible({ timeout: 10_000 });
    await bellButton.click();

    const viewAllLink = page.getByRole('link', { name: /view all notifications/i });
    await expect(viewAllLink).toBeVisible({ timeout: 5_000 });
    await viewAllLink.click();

    await expect(page).toHaveURL(/\/notifications/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});
