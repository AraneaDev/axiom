import type { AppError } from '../middleware/errorHandler';

/**
 * A cap on work running at once, per user and optionally in total. It refuses rather than queues,
 * so that slow work can't build up.
 * @param maxPerUser - The most one user can run
 * @param maxTotal - The most all users together can run
 */
export function createUserSlots(maxPerUser: number, maxTotal = Infinity) {
  const running = new Map<string, number>();
  let total = 0;
  return {
    async run<T>(userId: string, refusal: AppError, work: () => Promise<T>): Promise<T> {
      const mine = running.get(userId) ?? 0;
      if (mine >= maxPerUser || total >= maxTotal) throw refusal;
      running.set(userId, mine + 1);
      total++;
      try {
        return await work();
      } finally {
        total--;
        const left = (running.get(userId) ?? 1) - 1;
        if (left === 0) running.delete(userId);
        else running.set(userId, left);
      }
    },
  };
}
