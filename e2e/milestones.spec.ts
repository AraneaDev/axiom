import { test, expect } from '@playwright/test';

import { DEMO_USERS, login, ORG } from './helpers';

const TEAM = 'axiom';
const PROJECT = 'axiom-mvp';
const MILESTONES_URL = `/${ORG}/${TEAM}/${PROJECT}/milestones`;

test.describe('Milestones', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_USERS.admin);
  });

  test('can view milestones list page', async ({ page }) => {
    await page.goto(MILESTONES_URL);

    await expect(page.getByRole('heading', { name: /milestones/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Filter tabs should be visible
    await expect(page.getByRole('button', { name: /open/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /closed/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /all/i }).first()).toBeVisible();

    // New Milestone button should be present
    await expect(page.getByRole('button', { name: /new milestone/i })).toBeVisible();
  });

  test('can create a new milestone without due date', async ({ page }) => {
    await page.goto(MILESTONES_URL);

    await expect(page.getByRole('heading', { name: /milestones/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Open the create modal
    await page.getByRole('button', { name: /new milestone/i }).click();

    // Modal should appear
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('New Milestone')).toBeVisible();

    // Fill in the title
    await page.getByLabel('Title').fill('E2E Test Milestone');

    // Submit
    await page.getByRole('button', { name: /create milestone/i }).click();

    // Modal should close and new milestone should appear
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E Test Milestone').first()).toBeVisible({ timeout: 10_000 });
  });

  test('can create a milestone with a due date and description', async ({ page }) => {
    await page.goto(MILESTONES_URL);

    await expect(page.getByRole('heading', { name: /milestones/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /new milestone/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    await page.getByLabel('Title').fill('Dated Milestone');
    await page.getByLabel('Description').fill('A milestone with a deadline');
    await page.getByLabel('Due Date').fill('2026-12-31');

    await page.getByRole('button', { name: /create milestone/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Dated Milestone').first()).toBeVisible({ timeout: 10_000 });
  });

  test('create milestone modal can be cancelled', async ({ page }) => {
    await page.goto(MILESTONES_URL);

    await expect(page.getByRole('heading', { name: /milestones/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /new milestone/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    await page.getByLabel('Title').fill('Should Not Be Created');

    await page.getByRole('button', { name: /cancel/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Should Not Be Created')).not.toBeVisible();
  });

  test('can close and reopen a milestone', async ({ page }) => {
    await page.goto(MILESTONES_URL);

    await expect(page.getByRole('heading', { name: /milestones/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // First create a milestone to work with
    await page.getByRole('button', { name: /new milestone/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByLabel('Title').fill('Toggle Status Milestone');
    await page.getByRole('button', { name: /create milestone/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Toggle Status Milestone').first()).toBeVisible({
      timeout: 10_000,
    });

    // Close the milestone using the Close button
    await page.getByTitle('Close milestone').last().click();

    // Switch to Closed tab to verify it moved there
    await page.getByRole('button', { name: /^closed$/i }).click();
    await expect(page.getByText('Toggle Status Milestone').first()).toBeVisible({
      timeout: 10_000,
    });

    // Reopen it
    await page.getByTitle('Reopen milestone').last().click();

    // Switch back to Open tab to verify it is back
    await page.getByRole('button', { name: /^open$/i }).click();
    await expect(page.getByText('Toggle Status Milestone').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('milestone card shows issue count and progress bar', async ({ page }) => {
    await page.goto(MILESTONES_URL);

    await expect(page.getByRole('heading', { name: /milestones/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Create a milestone so there is at least one card to inspect
    await page.getByRole('button', { name: /new milestone/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByLabel('Title').fill('Progress Check Milestone');
    await page.getByRole('button', { name: /create milestone/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    await expect(page.getByText('Progress Check Milestone').first()).toBeVisible({
      timeout: 10_000,
    });

    // The card should show issue count and progress label
    await expect(page.getByText(/\d+ issues?/).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Progress').first()).toBeVisible();
  });
});
