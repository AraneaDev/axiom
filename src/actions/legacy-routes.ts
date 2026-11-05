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
  { method: 'POST', path: '/api/invitations/:token/accept', plan: 4 },
  { method: 'GET', path: '/api/links/resolve-link', plan: 4 },
  { method: 'GET', path: '/api/notifications', plan: 4 },
  { method: 'PATCH', path: '/api/notifications/:id/read', plan: 4 },
  { method: 'GET', path: '/api/notifications/preferences', plan: 4 },
  { method: 'PATCH', path: '/api/notifications/preferences', plan: 4 },
  { method: 'POST', path: '/api/notifications/read-all', plan: 4 },
  { method: 'GET', path: '/api/notifications/unread-count', plan: 4 },
  { method: 'GET', path: '/api/orgs/:orgId/analytics', plan: 4 },
  { method: 'GET', path: '/api/projects/:projectId/activity', plan: 4 },
  { method: 'GET', path: '/api/projects/:projectId/analytics', plan: 4 },
  { method: 'GET', path: '/api/projects/:projectId/issues/:issueNumber/activity', plan: 4 },
  { method: 'GET', path: '/api/site-settings', plan: 4 },
  { method: 'PUT', path: '/api/site-settings', plan: 4 },
  { method: 'GET', path: '/api/teams/:teamId/activity', plan: 4 },
  { method: 'GET', path: '/api/teams/:teamId/analytics', plan: 4 },
  { method: 'GET', path: '/api/teams/:teamId/members/profile/:username', plan: 4 },
  { method: 'GET', path: '/api/users/me', plan: 4 },
  { method: 'PATCH', path: '/api/users/me', plan: 4 },
  { method: 'GET', path: '/api/users/me/dashboard', plan: 4 },
  { method: 'GET', path: '/api/users/me/pending-approvals', plan: 4 },
  { method: 'GET', path: '/api/users/me/tokens', plan: 4 },
  { method: 'GET', path: '/api/users/search', plan: 4 },
];
