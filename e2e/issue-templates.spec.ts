import { test, expect } from '@playwright/test';

import { DEMO_USERS, login, ORG } from './helpers';

const TEAM = 'axiom';
const PROJECT = 'axiom-mvp';
const TEMPLATES_URL = `/${ORG}/${TEAM}/${PROJECT}/settings/templates`;
const CREATE_ISSUE_URL = `/${ORG}/${TEAM}/${PROJECT}/issues/new`;

test.describe('Issue Templates', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USERS.admin);
  });

  test('can view issue templates settings page', async ({ page }) => {
    await page.goto(TEMPLATES_URL);
    await expect(page.getByRole('heading', { name: /issue templates/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /new template/i })).toBeVisible();
  });

  test('can create a new issue template', async ({ page }) => {
    await page.goto(TEMPLATES_URL);
    await expect(page.getByRole('heading', { name: /issue templates/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Open the add form
    await page.getByRole('button', { name: /new template/i }).click();

    // Fill in template name and title pattern
    await page.getByLabel('Template Name').fill('E2E Bug Report');
    await page.getByLabel('Title Pattern').fill('[Bug] Describe the issue');

    // Save
    await page.getByRole('button', { name: /create template/i }).click();

    // New template should appear in the list
    await expect(page.getByText('E2E Bug Report').first()).toBeVisible({ timeout: 10_000 });
  });

  test('can create a template and use it on the issue creation form', async ({ page }) => {
    // Ensure a known template exists
    await page.goto(TEMPLATES_URL);
    await expect(page.getByRole('heading', { name: /issue templates/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /new template/i }).click();
    await page.getByLabel('Template Name').fill('E2E Feature Request');
    await page.getByLabel('Title Pattern').fill('[Feature] My feature title');

    // Change type to STORY
    await page.getByLabel('Type').selectOption('STORY');

    await page.getByRole('button', { name: /create template/i }).click();
    await expect(page.getByText('E2E Feature Request').first()).toBeVisible({ timeout: 10_000 });

    // Navigate to create issue form
    await page.goto(CREATE_ISSUE_URL);
    await expect(page.getByRole('heading', { name: /create issue/i })).toBeVisible({
      timeout: 10_000,
    });

    // "From template" select should be present (templates exist now)
    await expect(page.getByLabel(/from template/i)).toBeVisible({ timeout: 10_000 });

    // Select the template we just created
    await page.getByLabel(/from template/i).selectOption({ label: /E2E Feature Request/i });

    // Title field should be pre-populated with the template title
    await expect(page.getByLabel('Title')).toHaveValue('[Feature] My feature title', {
      timeout: 5_000,
    });
  });

  test('can delete an issue template with confirmation', async ({ page }) => {
    // Create a disposable template
    await page.goto(TEMPLATES_URL);
    await expect(page.getByRole('heading', { name: /issue templates/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /new template/i }).click();
    await page.getByLabel('Template Name').fill('delete-me-template');
    await page.getByLabel('Title Pattern').fill('Temporary title');
    await page.getByRole('button', { name: /create template/i }).click();
    await expect(page.getByText('delete-me-template').first()).toBeVisible({ timeout: 10_000 });

    // Click the delete button for the last (newest) template
    await page.getByTitle('Delete template').last().click();

    // Confirm dialog
    await expect(page.getByText(/delete template/i).first()).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^delete$/i }).click();

    // Template should be gone
    await expect(page.getByText('delete-me-template')).not.toBeVisible({ timeout: 10_000 });
  });
});
