/**
 * Every route the frontend still calls that is not a registry action yet, each tagged with the
 * plan that migrates it. parity.test.ts keeps this list honest: a frontend call that is neither
 * a registry route nor listed here fails, and so does an entry that a registry route now serves.
 * Plan 4 ends with this list empty.
 */
export interface LegacyRoute {
  method: string;
  /** The Express path, with the /api prefix */
  path: string;
  plan: 3 | 4;
}

/** Plan 4 migrates what is left; plan 3 brought the admin reach of tokens behind approval. */
export const LEGACY_ROUTES: LegacyRoute[] = [
  { method: 'POST', path: '/api/auth/logout', plan: 4 },
  { method: 'POST', path: '/api/auth/2fa/disable', plan: 4 },
  { method: 'POST', path: '/api/auth/2fa/enable', plan: 4 },
  { method: 'POST', path: '/api/auth/2fa/verify', plan: 4 },
  { method: 'POST', path: '/api/auth/forgot-password', plan: 4 },
  { method: 'POST', path: '/api/auth/login', plan: 4 },
  { method: 'POST', path: '/api/auth/refresh', plan: 4 },
  { method: 'POST', path: '/api/auth/register', plan: 4 },
  { method: 'POST', path: '/api/auth/reset-password', plan: 4 },
  { method: 'GET', path: '/api/health', plan: 4 },
  { method: 'GET', path: '/api/site-settings', plan: 4 },
  { method: 'PUT', path: '/api/site-settings', plan: 4 },
];
