/**
 * The name shown for who wrote an issue or a comment. Imported GitHub text whose GitHub author is
 * not a connected member is written by the integration user, and shows the GitHub login.
 * @param user The Axiom author
 * @param externalAuthorLogin The GitHub login of an imported author, when there is one
 */
export function authorName(
  user: { displayName: string } | null | undefined,
  externalAuthorLogin?: string | null,
): string {
  if (externalAuthorLogin) return `GitHub (${externalAuthorLogin})`;
  return user?.displayName ?? '';
}
