import { describe, it, expect } from 'vitest';

import { parseAxiomUrl } from './resolve-link.service';

describe('parseAxiomUrl', () => {
  // ── Issue patterns ──────────────────────────────────────────────────

  it('parses an issue path', () => {
    const result = parseAxiomUrl('/acme/backend/my-project/issues/42');
    expect(result).toEqual({
      type: 'issue',
      org: 'acme',
      team: 'backend',
      target: 'my-project',
      identifier: '42',
    });
  });

  it('parses a full issue URL with hostname', () => {
    const result = parseAxiomUrl('https://axiom.example.com/acme/backend/proj/issues/7');
    expect(result).toEqual({
      type: 'issue',
      org: 'acme',
      team: 'backend',
      target: 'proj',
      identifier: '7',
    });
  });

  // ── PR patterns ─────────────────────────────────────────────────────

  it('parses a PR path', () => {
    const result = parseAxiomUrl('/acme/backend/repos/api-server/pulls/15');
    expect(result).toEqual({
      type: 'pr',
      org: 'acme',
      team: 'backend',
      target: 'api-server',
      identifier: '15',
    });
  });

  it('parses a full PR URL with hostname', () => {
    const result = parseAxiomUrl('http://localhost:7000/org/team/repos/repo/pulls/3');
    expect(result).toEqual({
      type: 'pr',
      org: 'org',
      team: 'team',
      target: 'repo',
      identifier: '3',
    });
  });

  // ── Wiki patterns ──────────────────────────────────────────────────

  it('parses a wiki path', () => {
    const result = parseAxiomUrl('/acme/backend/wiki/engineering/getting-started');
    expect(result).toEqual({
      type: 'wiki',
      org: 'acme',
      team: 'backend',
      target: 'engineering',
      identifier: 'getting-started',
    });
  });

  it('parses a full wiki URL with hostname', () => {
    const result = parseAxiomUrl('https://app.axiom.dev/org/team/wiki/space/page-slug');
    expect(result).toEqual({
      type: 'wiki',
      org: 'org',
      team: 'team',
      target: 'space',
      identifier: 'page-slug',
    });
  });

  // ── Non-matching ───────────────────────────────────────────────────

  it('returns null for unrelated paths', () => {
    expect(parseAxiomUrl('/login')).toBeNull();
    expect(parseAxiomUrl('/acme/backend/settings')).toBeNull();
    expect(parseAxiomUrl('https://google.com')).toBeNull();
  });

  it('returns null for partial matches', () => {
    // Missing issue number
    expect(parseAxiomUrl('/acme/backend/proj/issues')).toBeNull();
    // Extra segment after number
    expect(parseAxiomUrl('/acme/backend/proj/issues/42/comments')).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(parseAxiomUrl('not a url at all')).toBeNull();
  });
});
