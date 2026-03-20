import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface McpToolContext {
  server: McpServer;
  userId: string;
  getUserOrgIds: () => Promise<string[]>;
  getOrgIdFromProject: (projectId: string) => Promise<string | undefined>;
  getOrgIdFromRepo: (repoId: string) => Promise<string | undefined>;
  getOrgIdFromSprint: (sprintId: string) => Promise<string | undefined>;
}
