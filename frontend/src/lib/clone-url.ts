/**
 * Build the SSH clone URL for a repository. The short scp form cannot carry a port,
 * so any port other than 22 needs the ssh:// form.
 * @param host - SSH host shown to users
 * @param port - SSH port shown to users
 * @param repoPath - `org/team/repo` without `.git`
 */
export function buildSshCloneUrl(host: string, port: number, repoPath: string): string {
  if (port === 22) return `git@${host}:${repoPath}.git`;
  const urlHost = host.includes(':') ? `[${host}]` : host;
  return `ssh://git@${urlHost}:${port}/${repoPath}.git`;
}
