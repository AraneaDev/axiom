import { describe, it, expect } from 'vitest';

import { buildSshCloneUrl } from './clone-url';

describe('buildSshCloneUrl', () => {
  it('uses the scp form on port 22', () => {
    expect(buildSshCloneUrl('git.example.com', 22, 'org/team/repo')).toBe(
      'git@git.example.com:org/team/repo.git',
    );
  });

  it('uses an ssh:// URL on any other port', () => {
    expect(buildSshCloneUrl('git.example.com', 2222, 'org/team/repo')).toBe(
      'ssh://git@git.example.com:2222/org/team/repo.git',
    );
  });

  it('brackets IPv6 hosts in ssh:// URLs', () => {
    expect(buildSshCloneUrl('::1', 2222, 'o/t/r')).toBe('ssh://git@[::1]:2222/o/t/r.git');
  });
});
