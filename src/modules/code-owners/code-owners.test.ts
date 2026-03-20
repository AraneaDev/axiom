import { describe, it, expect } from 'vitest';

import { parseCodeOwnersContent } from './code-owners.service';

describe('Code Owners', () => {
  // -- parseCodeOwnersContent -----------------------------------------

  describe('parseCodeOwnersContent', () => {
    it('should parse basic CODEOWNERS rules', () => {
      const content = '*.ts @alice @bob\n/docs/ @carol\n';
      const rules = parseCodeOwnersContent(content);
      expect(rules).toEqual([
        { pattern: '*.ts', owners: ['@alice', '@bob'] },
        { pattern: '/docs/', owners: ['@carol'] },
      ]);
    });

    it('should skip blank lines and comments', () => {
      const content = ['# This is a comment', '', '   # Indented comment', '*.js @alice', ''].join(
        '\n',
      );
      const rules = parseCodeOwnersContent(content);
      expect(rules).toEqual([{ pattern: '*.js', owners: ['@alice'] }]);
    });

    it('should skip lines without @-prefixed owners', () => {
      const content = '*.ts plainuser\n*.js @valid\n';
      const rules = parseCodeOwnersContent(content);
      expect(rules).toEqual([{ pattern: '*.js', owners: ['@valid'] }]);
    });

    it('should skip lines with only a pattern and no owners', () => {
      const content = '*.ts\n';
      const rules = parseCodeOwnersContent(content);
      expect(rules).toEqual([]);
    });

    it('should handle multiple owners on a single line', () => {
      const content = 'src/api/ @alice @bob @carol\n';
      const rules = parseCodeOwnersContent(content);
      expect(rules).toEqual([{ pattern: 'src/api/', owners: ['@alice', '@bob', '@carol'] }]);
    });

    it('should handle mixed whitespace (tabs and spaces)', () => {
      const content = '*.go\t@alice   @bob\n';
      const rules = parseCodeOwnersContent(content);
      expect(rules).toEqual([{ pattern: '*.go', owners: ['@alice', '@bob'] }]);
    });

    it('should return empty array for empty content', () => {
      expect(parseCodeOwnersContent('')).toEqual([]);
    });

    it('should return empty array for comments-only content', () => {
      const content = '# comment 1\n# comment 2\n';
      expect(parseCodeOwnersContent(content)).toEqual([]);
    });

    it('should handle glob patterns with double-star', () => {
      const content = 'src/**/*.test.ts @testers\n';
      const rules = parseCodeOwnersContent(content);
      expect(rules).toEqual([{ pattern: 'src/**/*.test.ts', owners: ['@testers'] }]);
    });

    it('should handle multiple rules and preserve order', () => {
      const content = [
        '* @fallback',
        '/src/ @dev-team',
        '/src/api/ @api-team',
        '*.md @docs-team',
      ].join('\n');
      const rules = parseCodeOwnersContent(content);
      expect(rules).toHaveLength(4);
      expect(rules[0].pattern).toBe('*');
      expect(rules[3].pattern).toBe('*.md');
    });

    it('should filter non-@ tokens from owners list', () => {
      const content = '*.ts @alice some-plain-text @bob\n';
      const rules = parseCodeOwnersContent(content);
      expect(rules).toEqual([{ pattern: '*.ts', owners: ['@alice', '@bob'] }]);
    });
  });
});
