import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { registerPaths } from '../registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Schema = Record<string, any>;

interface Param {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: Schema;
  description?: string;
  [key: `x-${string}`]: unknown;
}

const repoObject: Schema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string' },
    visibility: { type: 'string', enum: ['PRIVATE', 'INTERNAL', 'PUBLIC'] },
    defaultBranch: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const teamParams: Param[] = [
  { name: 'org', in: 'path', required: true, schema: { type: 'string' } },
  { name: 'team', in: 'path', required: true, schema: { type: 'string' } },
];

const repoParams: Param[] = [
  ...teamParams,
  { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
];

const paths: ZodOpenApiPathsObject = {
  '/repos/{org}/{team}': {
    get: {
      tags: ['Repos'],
      summary: 'List repositories for a team',
      security: [{ bearerAuth: [] }],
      parameters: [...teamParams],
      responses: {
        '200': {
          description: 'List of repositories',
          content: {
            'application/json': {
              schema: { type: 'array', items: repoObject },
            },
          },
        },
        '401': { description: 'Not authenticated' },
        '404': { description: 'Team not found' },
      },
    },
    post: {
      tags: ['Repos'],
      summary: 'Create a repository',
      security: [{ bearerAuth: [] }],
      parameters: [...teamParams],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name', 'slug'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 100 },
                slug: { type: 'string', minLength: 2, maxLength: 50, pattern: '^[a-z0-9-]+$' },
                description: { type: 'string', maxLength: 500 },
                visibility: {
                  type: 'string',
                  enum: ['PRIVATE', 'INTERNAL', 'PUBLIC'],
                  default: 'PRIVATE',
                },
                defaultBranch: { type: 'string', maxLength: 100 },
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Repository created',
          content: { 'application/json': { schema: repoObject } },
        },
        '409': { description: 'Slug already taken' },
      },
    },
  },

  '/repos/{org}/{team}/{repo}': {
    get: {
      tags: ['Repos'],
      summary: 'Get a repository',
      security: [{ bearerAuth: [] }],
      parameters: [...repoParams],
      responses: {
        '200': {
          description: 'Repository details',
          content: { 'application/json': { schema: repoObject } },
        },
        '404': { description: 'Repository not found' },
      },
    },
  },

  '/repos/{org}/{team}/{repo}/branches': {
    get: {
      tags: ['Repos'],
      summary: 'List branches',
      security: [{ bearerAuth: [] }],
      parameters: [...repoParams],
      responses: {
        '200': {
          description: 'Branch list',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    sha: { type: 'string' },
                    isDefault: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
        '404': { description: 'Repository not found' },
      },
    },
  },

  '/repos/{org}/{team}/{repo}/commits': {
    get: {
      tags: ['Repos'],
      summary: 'List commits',
      security: [{ bearerAuth: [] }],
      parameters: [
        ...repoParams,
        { name: 'branch', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
      responses: {
        '200': {
          description: 'Commit list',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    sha: { type: 'string' },
                    message: { type: 'string' },
                    author: { type: 'string' },
                    date: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
        '404': { description: 'Repository not found' },
      },
    },
  },
};

registerPaths(paths);
