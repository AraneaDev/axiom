import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface McpToolContext {
  server: McpServer;
  userId: string;
  getUserOrgIds: () => Promise<string[]>;
  getOrgIdFromProject: (projectId: string) => Promise<string | undefined>;
  getOrgIdFromPage: (pageId: string) => Promise<string | undefined>;
}
