import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { AppError } from '../middleware/errorHandler';

import { paramInt } from './params';

const withParam = (value: string) => ({ params: { n: value } }) as unknown as Request;

describe('paramInt', () => {
  it.each([
    ['5', 5],
    ['0', 0],
    ['007', 7],
    ['1234567', 1234567],
  ])('reads %s', (value, number) => {
    expect(paramInt(withParam(value), 'n')).toBe(number);
  });

  it.each(['5abc', 'abc', '1/issues/1/votes/toggle', '1.5', '-1', '+1', ' 5', '5 ', '1e3', '0x10'])(
    'refuses %j',
    (value) => {
      let thrown: unknown;
      try {
        paramInt(withParam(value), 'n');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).statusCode).toBe(400);
    },
  );
});
