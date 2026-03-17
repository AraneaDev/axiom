import { AsyncLocalStorage } from 'node:async_hooks';

export const mcpContext = new AsyncLocalStorage<{ userId: string }>();
