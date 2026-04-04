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

const prObject: Schema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    number: { type: 'integer' },
    title: { type: 'string' },
    body: { type: 'string' },
    sourceBranch: { type: 'string' },
    targetBranch: { type: 'string' },
    status: { type: 'string', enum: ['OPEN', 'MERGED', 'CLOSED'] },
    authorId: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const repoParams: Param[] = [
  { name: 'org', in: 'path', required: true, schema: { type: 'string' } },
  { name: 'team', in: 'path', required: true, schema: { type: 'string' } },
  { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
];

const prParams: Param[] = [
  ...repoParams,
  {
    name: 'prNumber',
    in: 'path',
    required: true,
    schema: { type: 'integer' },
    description: 'PR number',
  },
];

const paths: ZodOpenApiPathsObject = {
  '/repos/{org}/{team}/{repo}/pulls': {
    get: {
      tags: ['Pull Requests'],
      summary: 'List pull requests',
      security: [{ bearerAuth: [] }],
      parameters: [
        ...repoParams,
        {
          name: 'status',
          in: 'query',
          schema: { type: 'string', enum: ['OPEN', 'MERGED', 'CLOSED'] },
        },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
      responses: {
        '200': {
          description: 'List of pull requests',
          content: {
            'application/json': {
              schema: { type: 'array', items: prObject },
            },
          },
        },
        '401': { description: 'Not authenticated' },
        '404': { description: 'Repository not found' },
      },
    },
    post: {
      tags: ['Pull Requests'],
      summary: 'Create a pull request',
      security: [{ bearerAuth: [] }],
      parameters: [...repoParams],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title', 'sourceBranch', 'targetBranch'],
              properties: {
                title: { type: 'string', minLength: 1, maxLength: 200 },
                body: { type: 'string', maxLength: 100000 },
                sourceBranch: { type: 'string', minLength: 1 },
                targetBranch: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Pull request created',
          content: { 'application/json': { schema: prObject } },
        },
        '409': { description: 'PR already exists for these branches' },
        '422': { description: 'Validation error' },
      },
    },
  },

  '/repos/{org}/{team}/{repo}/pulls/{prNumber}': {
    get: {
      tags: ['Pull Requests'],
      summary: 'Get a pull request',
      security: [{ bearerAuth: [] }],
      parameters: [...prParams],
      responses: {
        '200': {
          description: 'Pull request details',
          content: { 'application/json': { schema: prObject } },
        },
        '404': { description: 'Pull request not found' },
      },
    },
    patch: {
      tags: ['Pull Requests'],
      summary: 'Update a pull request',
      security: [{ bearerAuth: [] }],
      parameters: [...prParams],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string', minLength: 1, maxLength: 200 },
                body: { type: 'string', maxLength: 100000 },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Updated pull request',
          content: { 'application/json': { schema: prObject } },
        },
        '404': { description: 'Pull request not found' },
      },
    },
  },

  '/repos/{org}/{team}/{repo}/pulls/{prNumber}/merge': {
    post: {
      tags: ['Pull Requests'],
      summary: 'Merge a pull request',
      security: [{ bearerAuth: [] }],
      parameters: [...prParams],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                strategy: { type: 'string', enum: ['merge', 'squash', 'rebase'], default: 'merge' },
                deleteSourceBranch: { type: 'boolean', default: false },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Pull request merged' },
        '409': { description: 'Merge conflict or PR not mergeable' },
        '404': { description: 'Pull request not found' },
      },
    },
  },
};

registerPaths(paths);
