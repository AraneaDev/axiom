import { describe, it, expect } from 'vitest';

import { renderEmailTemplate } from './templates';

describe('Email Templates', () => {
  const baseData = {
    recipientName: 'Alice',
    title: 'Test Issue #42',
    body: 'Something happened that you should know about.',
    link: '/aranea-dev/axiom/issues/42',
    appUrl: 'http://localhost:7000',
  };

  // ── Subject Lines ─────────────────────────────────────────

  describe('subject lines', () => {
    it('should render issue_assigned subject', () => {
      const result = renderEmailTemplate('issue_assigned', baseData);
      expect(result.subject).toBe('Issue assigned: Test Issue #42');
    });

    it('should render issue_commented subject', () => {
      const result = renderEmailTemplate('issue_commented', baseData);
      expect(result.subject).toBe('New comment: Test Issue #42');
    });

    it('should render pr_review_requested subject', () => {
      const result = renderEmailTemplate('pr_review_requested', baseData);
      expect(result.subject).toBe('Review requested: Test Issue #42');
    });

    it('should render pr_merged subject', () => {
      const result = renderEmailTemplate('pr_merged', baseData);
      expect(result.subject).toBe('Pull request merged: Test Issue #42');
    });

    it('should render mention subject', () => {
      const result = renderEmailTemplate('mention', baseData);
      expect(result.subject).toBe('You were mentioned: Test Issue #42');
    });

    it('should fall back to title for unknown event types', () => {
      const result = renderEmailTemplate('unknown_event', baseData);
      expect(result.subject).toBe('Test Issue #42');
    });
  });

  // ── HTML Output ───────────────────────────────────────────

  describe('HTML output', () => {
    it('should include recipient name', () => {
      const result = renderEmailTemplate('issue_assigned', baseData);
      expect(result.html).toContain('Hi Alice');
    });

    it('should include body text', () => {
      const result = renderEmailTemplate('issue_assigned', baseData);
      expect(result.html).toContain('Something happened that you should know about.');
    });

    it('should include action button with full URL', () => {
      const result = renderEmailTemplate('issue_assigned', baseData);
      expect(result.html).toContain('http://localhost:7000/aranea-dev/axiom/issues/42');
      expect(result.html).toContain('View in Axiom');
    });

    it('should include unsubscribe footer', () => {
      const result = renderEmailTemplate('issue_assigned', baseData);
      expect(result.html).toContain('notification preferences');
    });

    it('should omit body section when body is undefined', () => {
      const result = renderEmailTemplate('issue_assigned', {
        ...baseData,
        body: undefined,
      });
      expect(result.html).not.toContain('Something happened');
    });

    it('should omit action button when link is undefined', () => {
      const result = renderEmailTemplate('issue_assigned', {
        ...baseData,
        link: undefined,
      });
      expect(result.html).not.toContain('View in Axiom');
    });

    it('should escape HTML in title', () => {
      const result = renderEmailTemplate('issue_assigned', {
        ...baseData,
        title: '<script>alert("xss")</script>',
      });
      expect(result.html).not.toContain('<script>');
      expect(result.html).toContain('&lt;script&gt;');
    });

    it('should escape HTML in body', () => {
      const result = renderEmailTemplate('issue_assigned', {
        ...baseData,
        body: 'Hello <b>world</b> & "friends"',
      });
      expect(result.html).toContain('&lt;b&gt;world&lt;/b&gt;');
      expect(result.html).toContain('&amp;');
      expect(result.html).toContain('&quot;friends&quot;');
    });

    it('should escape HTML in recipient name', () => {
      const result = renderEmailTemplate('issue_assigned', {
        ...baseData,
        recipientName: '<img src=x onerror=alert(1)>',
      });
      expect(result.html).not.toContain('<img');
      expect(result.html).toContain('&lt;img');
    });

    it('should use default appUrl when not provided', () => {
      const result = renderEmailTemplate('issue_assigned', {
        recipientName: 'Alice',
        title: 'Test',
        link: '/issues/1',
      });
      expect(result.html).toContain('http://localhost:7000/issues/1');
    });
  });

  // ── Plain Text Output ─────────────────────────────────────

  describe('plain text output', () => {
    it('should include recipient name', () => {
      const result = renderEmailTemplate('issue_assigned', baseData);
      expect(result.text).toContain('Hi Alice');
    });

    it('should include body text', () => {
      const result = renderEmailTemplate('issue_assigned', baseData);
      expect(result.text).toContain('Something happened that you should know about.');
    });

    it('should include full link URL', () => {
      const result = renderEmailTemplate('issue_assigned', baseData);
      expect(result.text).toContain(
        'View in Axiom: http://localhost:7000/aranea-dev/axiom/issues/42',
      );
    });

    it('should include footer', () => {
      const result = renderEmailTemplate('issue_assigned', baseData);
      expect(result.text).toContain('notification preferences');
    });

    it('should omit body line when body is undefined', () => {
      const result = renderEmailTemplate('issue_assigned', {
        ...baseData,
        body: undefined,
      });
      expect(result.text).not.toContain('Something happened');
    });

    it('should omit link line when link is undefined', () => {
      const result = renderEmailTemplate('issue_assigned', {
        ...baseData,
        link: undefined,
      });
      expect(result.text).not.toContain('View in Axiom');
    });
  });

  // ── All 5 Template Types ──────────────────────────────────

  describe('all template types render without error', () => {
    const types = [
      'issue_assigned',
      'issue_commented',
      'pr_review_requested',
      'pr_merged',
      'mention',
    ];

    for (const type of types) {
      it(`should render ${type} with all fields`, () => {
        const result = renderEmailTemplate(type, baseData);
        expect(result.subject).toBeTruthy();
        expect(result.html).toBeTruthy();
        expect(result.text).toBeTruthy();
        expect(result.html).toContain('<!DOCTYPE html>');
      });
    }
  });
});
