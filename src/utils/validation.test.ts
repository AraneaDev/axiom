import { describe, it, expect } from 'vitest';

import { AppError } from '../middleware/errorHandler';

import { validate, loginSchema, createOrgSchema, createCommentSchema } from './validation';

describe('validate', () => {
  it('should return parsed data on valid input', () => {
    const data = validate(loginSchema, { login: 'user@test.com', password: 'secret123' });
    expect(data.login).toBe('user@test.com');
    expect(data.password).toBe('secret123');
  });

  it('should strip unknown fields from valid input', () => {
    const data = validate(loginSchema, {
      login: 'user@test.com',
      password: 'secret123',
      extraField: 'ignored',
    });
    expect(data.login).toBe('user@test.com');
    expect((data as Record<string, unknown>).extraField).toBeUndefined();
  });

  it('should throw AppError 400 on invalid input', () => {
    expect(() => validate(loginSchema, {})).toThrow(AppError);
    try {
      validate(loginSchema, {});
    } catch (err) {
      expect((err as AppError).statusCode).toBe(400);
    }
  });

  it('should include field names in error message', () => {
    try {
      validate(createOrgSchema, { name: '', slug: '!' });
    } catch (err) {
      const message = (err as AppError).message;
      expect(message).toContain('name');
    }
  });

  it('should validate createOrgSchema with correct data', () => {
    const data = validate(createOrgSchema, { name: 'My Org', slug: 'my-org' });
    expect(data.name).toBe('My Org');
    expect(data.slug).toBe('my-org');
  });

  it('should reject createOrgSchema with invalid slug', () => {
    expect(() => validate(createOrgSchema, { name: 'My Org', slug: 'INVALID SLUG!' })).toThrow(
      AppError,
    );
  });

  it('should validate createCommentSchema', () => {
    const data = validate(createCommentSchema, { body: 'A comment' });
    expect(data.body).toBe('A comment');
  });

  it('should reject createCommentSchema with empty body', () => {
    expect(() => validate(createCommentSchema, { body: '' })).toThrow(AppError);
  });
});
