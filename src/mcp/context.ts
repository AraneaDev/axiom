import { AsyncLocalStorage } from 'node:async_hooks';

/** Who an MCP call runs as; scopes are set when the request used an API token */
export const mcpContext = new AsyncLocalStorage<{ userId: string; scopes?: string[] }>();
