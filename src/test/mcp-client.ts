import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import app from '../index';

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
 * Serve the app, connect one client, run the work, and stop both.
 * @param authorization - The Authorization header, with its scheme
 * @param work - What to do with the client
 */
export async function withMcpClient<T>(
  authorization: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const served = await serveApp();
  try {
    const client = await connectMcp(served.base, authorization);
    try {
      return await work(client);
    } finally {
      await client.close();
    }
  } finally {
    await served.close();
  }
}
