import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import app from '../index';
import { TOKEN_SCOPES } from '../middleware/token-scopes';

import type { TestUser } from './factory';
import { authPost } from './helpers';

/**
 * Serve the app on a free port, for what needs a real socket.
 * @returns The base URL, and how to stop
 */
export async function serveApp(): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Connect an MCP client over Streamable HTTP.
 * @param base - From serveApp
 * @param authorization - The Authorization header, with its scheme
 */
export async function connectMcp(base: string, authorization: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
    requestInit: { headers: { Authorization: authorization } },
  });
  await client.connect(transport);
  return client;
}

/**
 * An Authorization header for a new API token of a user: /api/mcp takes tokens only.
 * @param user - The user, with a session
 * @param scopes - The token's scopes; by default all, so only the user's own access counts
 * @param name - The token's name, which writes carry as `via`
 */
export async function tokenHeaderFor(
  user: TestUser,
  scopes: readonly string[] = TOKEN_SCOPES,
  name = 'mcp-test',
): Promise<string> {
  const res = await authPost('/api/users/me/tokens', user.token, { name, scopes: [...scopes] });
  if (res.status !== 201) throw new Error(`Could not create a token: ${res.status}`);
  return `Token ${res.body.token}`;
}

/** What a tool answered, its text parsed. */
export interface ToolAnswer {
  isError: boolean;
  text: string;
  // Tests read what they asked for
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

/**
 * Call a tool.
 * @param client - From connectMcp
 * @param name - The tool
 * @param args - Its arguments
 */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolAnswer> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return { isError: res.isError === true, text, data: JSON.parse(text) };
}

/**
 * Serve the app, connect one client as a user through a token, run the work, and stop both.
 * @param user - The user
 * @param work - What to do with the client
 */
export async function withMcpClient<T>(
  user: TestUser,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const served = await serveApp();
  try {
    const client = await connectMcp(served.base, await tokenHeaderFor(user));
    try {
      return await work(client);
    } finally {
      await client.close();
    }
  } finally {
    await served.close();
  }
}
