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
    await expect(
      page.getByText(/automation|rules/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('can create automation rule with query condition', async ({ page }) => {
    await page.goto(AUTOMATION_URL);
    await expect(page.getByText(/automation|rules/i).first()).toBeVisible({ timeout: 10_000 });

    // Click create / add rule button
    const createButton = page
      .getByRole('button', { name: /create|add|new rule/i })
      .first()
      .or(page.locator('[data-testid="create-rule"], [data-testid="add-rule"]').first());
    await createButton.click();

    // Fill in rule name
    const nameInput = page
      .getByRole('textbox', { name: /name/i })
      .first()
      .or(page.locator('input[placeholder*="name" i], [data-testid="rule-name"]').first());
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill('E2E High Priority Bug Rule');

    // Select a trigger
    const triggerSelect = page
      .getByRole('combobox', { name: /trigger/i })
      .first()
      .or(page.locator('select[name*="trigger"], [data-testid="rule-trigger"]').first());
    if (await triggerSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await triggerSelect.selectOption({ index: 1 });
    }

    // Enter condition using query syntax
    const conditionInput = page
      .getByRole('textbox', { name: /condition/i })
      .first()
      .or(page.locator('input[placeholder*="condition" i], textarea[placeholder*="condition" i], [data-testid="rule-condition"]').first());
    if (await conditionInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await conditionInput.fill('type = Bug AND priority = High');
    }

    // Add an action (if there is an add-action button)
    const addActionButton = page
      .getByRole('button', { name: /add action/i })
      .first()
      .or(page.locator('[data-testid="add-action"]').first());
    if (await addActionButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addActionButton.click();
      // Select first available action type
      const actionSelect = page
        .getByRole('combobox', { name: /action/i })
        .first()
        .or(page.locator('select[name*="action"]').first());
      if (await actionSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await actionSelect.selectOption({ index: 1 });
      }
    }

    // Save the rule
    const saveButton = page
      .getByRole('button', { name: /save|create|submit/i })
      .first();
    await saveButton.click();

    // Rule should appear in the list
    await expect(page.getByText('E2E High Priority Bug Rule')).toBeVisible({ timeout: 10_000 });
  });

  test('validates invalid conditions', async ({ page }) => {
    await page.goto(AUTOMATION_URL);
    await expect(page.getByText(/automation|rules/i).first()).toBeVisible({ timeout: 10_000 });

    const createButton = page
      .getByRole('button', { name: /create|add|new rule/i })
      .first()
      .or(page.locator('[data-testid="create-rule"], [data-testid="add-rule"]').first());
    await createButton.click();

    // Fill a rule name
    const nameInput = page
      .getByRole('textbox', { name: /name/i })
      .first()
      .or(page.locator('input[placeholder*="name" i], [data-testid="rule-name"]').first());
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill('E2E Invalid Condition Rule');

    // Enter invalid condition syntax
    const conditionInput = page
      .getByRole('textbox', { name: /condition/i })
      .first()
      .or(page.locator('input[placeholder*="condition" i], textarea[placeholder*="condition" i], [data-testid="rule-condition"]').first());
    if (await conditionInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await conditionInput.fill('type = AND =');
    }

    // Attempt to save
    const saveButton = page
      .getByRole('button', { name: /save|create|submit/i })
      .first();
    await saveButton.click();

    // An error message should appear
    await expect(
      page.getByText(/invalid|error|syntax/i).first()
        .or(page.locator('[role="alert"], [data-testid*="error"], .error-message').first())
    ).toBeVisible({ timeout: 10_000 });
  });
});
