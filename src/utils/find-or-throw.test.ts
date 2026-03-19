import { describe, it, expect } from 'vitest';

import { AppError } from '../middleware/errorHandler';

import { findOrThrow } from './find-or-throw';

describe('findOrThrow', () => {
  it('should return value when promise resolves non-null', async () => {
    const result = await findOrThrow(Promise.resolve({ id: '1', name: 'test' }), 'Not found');
    expect(result).toEqual({ id: '1', name: 'test' });
  });

  it('should throw AppError 404 when promise resolves null', async () => {
    await expect(findOrThrow(Promise.resolve(null), 'Item not found')).rejects.toThrow(AppError);
    try {
      await findOrThrow(Promise.resolve(null), 'Item not found');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(404);
      expect((err as AppError).message).toBe('Item not found');
    }
  });

  it('should throw AppError 404 when promise resolves undefined', async () => {
    await expect(
      findOrThrow(Promise.resolve(undefined) as Promise<null>, 'Missing resource'),
    ).rejects.toThrow(AppError);
  });

  it('should throw with the correct custom message', async () => {
    try {
      await findOrThrow(Promise.resolve(null), 'Organization not found');
    } catch (err) {
      expect((err as AppError).message).toBe('Organization not found');
    }
  });

  it('should throw on falsy values like 0 and empty string', async () => {
    await expect(findOrThrow(Promise.resolve(0 as unknown as null), 'Not found')).rejects.toThrow(
      AppError,
    );
    await expect(findOrThrow(Promise.resolve('' as unknown as null), 'Not found')).rejects.toThrow(
      AppError,
    );
  });
});
