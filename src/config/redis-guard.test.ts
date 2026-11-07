import { describe, expect, it } from 'vitest';

import { assertRedisEnabled } from './redis-guard';

describe('assertRedisEnabled', () => {
  it('passes when the switch is not set', () => {
    expect(() => assertRedisEnabled({})).not.toThrow();
    expect(() => assertRedisEnabled({ AXIOM_NO_REDIS: '0' })).not.toThrow();
  });

  it('refuses to start a server or a worker with the migrate switch set', () => {
    expect(() => assertRedisEnabled({ AXIOM_NO_REDIS: '1' })).toThrow(/AXIOM_NO_REDIS/);
  });
});
