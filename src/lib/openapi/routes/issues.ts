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

const issueObject: Schema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    number: { type: 'integer' },
    title: { type: 'string' },
    body: { type: 'string' },
    type: { type: 'string', enum: ['TASK', 'BUG', 'STORY', 'EPIC'] },
    priority: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
    assigneeId: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const projectParams: Param[] = [
  { name: 'org', in: 'path', required: true, schema: { type: 'string' } },
  { name: 'team', in: 'path', required: true, schema: { type: 'string' } },
  { name: 'project', in: 'path', required: true, schema: { type: 'string' } },
];

const issueParams: Param[] = [
  ...projectParams,
  {
    name: 'num',
    in: 'path',
    required: true,
    schema: { type: 'integer' },
    description: 'Issue number',
  },
];

const paths: ZodOpenApiPathsObject = {
  '/projects/{org}/{team}/{project}/issues': {
    get: {
      tags: ['Issues'],
      summary: 'List issues for a project',
      security: [{ bearerAuth: [] }],
      parameters: [
        ...projectParams,
        { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search query' },
        { name: 'type', in: 'query', schema: { type: 'string' } },
        { name: 'priority', in: 'query', schema: { type: 'string' } },
        { name: 'assigneeId', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
      responses: {
        '200': {
          description: 'List of issues',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  issues: { type: 'array', items: issueObject },
                  total: { type: 'integer' },
                },
              },
            },
          },
        },
        '401': { description: 'Not authenticated' },
        '404': { description: 'Project not found' },
      },
    },
    post: {
      tags: ['Issues'],
      summary: 'Create a new issue',
      security: [{ bearerAuth: [] }],
      parameters: [...projectParams],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title'],
              properties: {
                title: { type: 'string', minLength: 1, maxLength: 200 },
                body: { type: 'string', maxLength: 100000 },
                type: { type: 'string', enum: ['TASK', 'BUG', 'STORY', 'EPIC'], default: 'TASK' },
                priority: {
                  type: 'string',
                  enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
                  default: 'MEDIUM',
                },
                assigneeId: { type: 'string' },
                labels: { type: 'array', items: { type: 'string' } },
                dueDate: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Issue created',
          content: { 'application/json': { schema: issueObject } },
        },
        '401': { description: 'Not authenticated' },
        '422': { description: 'Validation error' },
      },
    },
  },

  '/projects/{org}/{team}/{project}/issues/{num}': {
    get: {
      tags: ['Issues'],
      summary: 'Get a single issue by number',
      security: [{ bearerAuth: [] }],
      parameters: [...issueParams],
      responses: {
        '200': {
          description: 'Issue details',
          content: { 'application/json': { schema: issueObject } },
        },
        '401': { description: 'Not authenticated' },
        '404': { description: 'Issue not found' },
      },
    },
    patch: {
      tags: ['Issues'],
      summary: 'Update an issue',
      security: [{ bearerAuth: [] }],
      parameters: [...issueParams],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string', maxLength: 200 },
                body: { type: 'string', maxLength: 100000 },
                type: { type: 'string', enum: ['TASK', 'BUG', 'STORY', 'EPIC'] },
                priority: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
                assigneeId: { type: 'string' },
                columnId: { type: 'string' },
                storyPoints: { type: 'integer', minimum: 0, maximum: 100 },
                sprintId: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Updated issue',
          content: { 'application/json': { schema: issueObject } },
        },
        '401': { description: 'Not authenticated' },
        '404': { description: 'Issue not found' },
      },
    },
    delete: {
      tags: ['Issues'],
      summary: 'Delete an issue',
      security: [{ bearerAuth: [] }],
      parameters: [...issueParams],
      responses: {
        '204': { description: 'Issue deleted' },
        '401': { description: 'Not authenticated' },
        '404': { description: 'Issue not found' },
      },
    },
  },
};

registerPaths(paths);
