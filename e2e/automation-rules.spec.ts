import { test, expect } from '@playwright/test';

import { login, ORG } from './helpers';

const TEAM = 'core';
const PROJECT = 'platform';
const SETTINGS_URL = `/${ORG}/${TEAM}/${PROJECT}/settings`;
const AUTOMATION_URL = `${SETTINGS_URL}/automation`;

test.describe('Automation Rules', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('shows automation rules page', async ({ page }) => {
    await page.goto(AUTOMATION_URL);
    // Use level=1 to avoid ambiguity with sidebar nav text
    await expect(page.getByRole('heading', { name: /automation rules/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    // The seeded rule should be listed
    await expect(page.getByText('Auto-label critical bugs')).toBeVisible({ timeout: 10_000 });
  });

  test('can open the new rule form', async ({ page }) => {
    await page.goto(AUTOMATION_URL);
    await expect(page.getByRole('heading', { name: /automation rules/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Click "New Rule" button
    await page.getByRole('button', { name: /new rule/i }).click();

    // Form fields should appear — use placeholder since Input label isn't aria-linked
    await expect(page.getByPlaceholder(/auto-label bugs/i)).toBeVisible({ timeout: 10_000 });
  });

  test('can create automation rule', async ({ page }) => {
    await page.goto(AUTOMATION_URL);
    await expect(page.getByRole('heading', { name: /automation rules/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Click "New Rule"
    await page.getByRole('button', { name: /new rule/i }).click();

    // Fill in rule name via placeholder
    const nameInput = page.getByPlaceholder(/auto-label bugs/i);
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill('E2E High Priority Bug Rule');

    // First action row is already present (type: add_label), fill in label name
    const labelInput = page.getByPlaceholder(/label name/i);
    if (await labelInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await labelInput.fill('high-priority');
    }

    // Save the rule
    await page.getByRole('button', { name: /save rule/i }).click();

    // Rule should appear in the list
    await expect(page.getByText('E2E High Priority Bug Rule')).toBeVisible({ timeout: 10_000 });
  });

  test('can add a condition to a rule', async ({ page }) => {
    await page.goto(AUTOMATION_URL);
    await expect(page.getByRole('heading', { name: /automation rules/i, level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /new rule/i }).click();

    const nameInput = page.getByPlaceholder(/auto-label bugs/i);
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill('E2E Condition Rule');

    // Click "Add Condition"
    await page.getByRole('button', { name: /add condition/i }).click();

    // A condition row should now be visible — it has a value input with placeholder "Value"
    await expect(page.getByPlaceholder(/^value$/i).first()).toBeVisible({ timeout: 10_000 });

    // Fill the action label and save
    const labelInput = page.getByPlaceholder(/label name/i);
    if (await labelInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await labelInput.fill('test-label');
    }
    await page.getByRole('button', { name: /save rule/i }).click();

    await expect(page.getByText('E2E Condition Rule')).toBeVisible({ timeout: 10_000 });
  });

  test('can toggle a rule enabled/disabled', async ({ page }) => {
    await page.goto(AUTOMATION_URL);
    await expect(page.getByText('Auto-label critical bugs')).toBeVisible({ timeout: 10_000 });

    // The seeded rule is enabled — click Disable
    await page.getByRole('button', { name: /disable/i }).first().click();

    // Should now show "Disabled" status
    await expect(page.getByText('Disabled').first()).toBeVisible({ timeout: 10_000 });

    // Re-enable
    await page.getByRole('button', { name: /enable/i }).first().click();

    // Should show "Active" again
    await expect(page.getByText('Active').first()).toBeVisible({ timeout: 10_000 });
  });
});
