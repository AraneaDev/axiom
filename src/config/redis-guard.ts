/**
 * Refuses to go on when a one-shot script's switch is set in a process that serves requests or
 * runs jobs: without the Redis connection the cache, the bridge and the queues would be dead
 * and nothing would say why.
 * @param env The environment to check
 * @throws {Error} When AXIOM_NO_REDIS is 1
 */
export function assertRedisEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (env.AXIOM_NO_REDIS === '1') {
    throw new Error(
      'AXIOM_NO_REDIS=1 is for one-shot scripts such as migrate; unset it to start the API or the worker',
    );
  }
}
