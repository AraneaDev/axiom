import { test, expect, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateSync } from 'otplib';
import { Pool } from 'pg';

import { DEMO_USERS } from './helpers';

const E2E_DB_URL = 'postgresql://axiom:axiom_dev@localhost:5432/axiom_e2e?schema=public';
const USER = { login: 'no-2fa-user', password: 'password123', display: 'No 2FA User' };

/** Sign in through the form, without the helper's wait: the app redirects on its own. */
async function signIn(page: Page, code?: string) {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(USER.login);
  await page.getByLabel('Password').fill(USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (code) {
    await page.getByLabel('Authentication code').fill(code);
    await page.getByRole('button', { name: /verify|sign in/i }).click();
  }
}

/** Assert the page comes to rest here: a redirect loop keeps loading documents. */
async function expectToSettleOn(page: Page, path: string) {
  await expect(page).toHaveURL(path);
  let documents = 0;
  const count = (request: { isNavigationRequest(): boolean }) => {
    if (request.isNavigationRequest()) documents += 1;
  };
  page.on('request', count);
  await page.waitForTimeout(3_000);
  page.off('request', count);
  expect(documents, 'page loads while waiting').toBe(0);
  await expect(page).toHaveURL(path);
}

test.describe.serial('Enforced 2FA, for a user without it', () => {
  let prisma: PrismaClient;
  let pool: Pool;
  let enforcedBefore = false;

  /**
   * Set the site setting in the database. The seeded users are not platform admins.
   */
  async function setEnforced(enforce2fa: boolean) {
    await prisma.siteSettings.upsert({
      where: { id: 1 },
      create: { id: 1, enforce2fa },
      update: { enforce2fa },
    });
  }

  test.beforeAll(async () => {
    pool = new Pool({ connectionString: E2E_DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as never);
    await prisma.user.deleteMany({ where: { username: USER.login } });
    await prisma.user.create({
      data: {
        email: 'no-2fa-user@axiom.local',
        username: USER.login,
        displayName: USER.display,
        passwordHash: await bcrypt.hash(USER.password, 4),
      },
    });
    const settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
    enforcedBefore = settings?.enforce2fa === true;
    await setEnforced(true);
  });

  test.afterAll(async () => {
    await setEnforced(enforcedBefore);
    await prisma.user.deleteMany({ where: { username: USER.login } });
    await prisma.$disconnect();
    await pool.end();
  });

  test('signing in ends on the setup page, without a redirect loop', async ({ page }) => {
    await signIn(page);
    await expectToSettleOn(page, '/setup-2fa');
    await expect(
      page.getByRole('heading', { name: 'Set up two-factor authentication' }),
    ).toBeVisible();
  });

  test('loading the app at any path ends there too', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL('/setup-2fa');
    for (const path of ['/dashboard', '/settings/security', '/']) {
      await page.goto(path);
      await expectToSettleOn(page, '/setup-2fa');
    }
    // The session survived all of that
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Set up two-factor authentication' }),
    ).toBeVisible();
  });

  test('the setup page offers a way to sign out', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL('/setup-2fa');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('/');
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/');
  });

  test('completing setup opens the app, and the next sign-in asks for a code', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL('/setup-2fa');
    const secret = (await page.locator('code').first().textContent())!.trim();
    await page.getByPlaceholder('Enter 6-digit code').fill(generateSync({ secret }));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectToSettleOn(page, '/dashboard');
    await expect(page.getByText(USER.display).first()).toBeVisible();

    await page
      .getByRole('button', { name: new RegExp(USER.display, 'i') })
      .first()
      .click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('/');

    await signIn(page, generateSync({ secret }));
    await expectToSettleOn(page, '/dashboard');
  });
});

test.describe('After the 2FA specs', () => {
  test('the setting is off again for the other specs', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or username').fill(DEMO_USERS.sarah.login);
    await page.getByLabel('Password').fill(DEMO_USERS.sarah.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expectToSettleOn(page, '/dashboard');
  });
});
