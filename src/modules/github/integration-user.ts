/** The id of the built-in GitHub integration user, inserted by the migration that adds `User.kind` */
export const GITHUB_INTEGRATION_USER_ID = 'github-integration';

/**
 * Whether a user is the built-in GitHub integration user. It compares the id and runs no query,
 * so a refusal can sit on a hot path.
 * @param userId - The user id to test
 * @returns true for the integration user
 */
export function isIntegrationUser(userId: string): boolean {
  return userId === GITHUB_INTEGRATION_USER_ID;
}
