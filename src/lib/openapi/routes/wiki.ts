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

const spaceObject: Schema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const pageObject: Schema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    slug: { type: 'string' },
    body: { type: 'string' },
    isDraft: { type: 'boolean' },
    version: { type: 'integer' },
    parentId: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const teamParams: Param[] = [
  { name: 'org', in: 'path', required: true, schema: { type: 'string' } },
  { name: 'team', in: 'path', required: true, schema: { type: 'string' } },
];

const spaceParams: Param[] = [
  ...teamParams,
  {
    name: 'space',
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: 'Space slug',
  },
];

const pageParams: Param[] = [
  ...spaceParams,
  {
    name: 'page',
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: 'Page slug',
  },
];

const paths: ZodOpenApiPathsObject = {
  '/wiki/{org}/{team}/spaces': {
    get: {
      tags: ['Wiki'],
      summary: 'List wiki spaces for a team',
      security: [{ bearerAuth: [] }],
      parameters: [...teamParams],
      responses: {
        '200': {
          description: 'List of spaces',
          content: {
            'application/json': {
              schema: { type: 'array', items: spaceObject },
            },
          },
        },
        '401': { description: 'Not authenticated' },
        '404': { description: 'Team not found' },
      },
    },
    post: {
      tags: ['Wiki'],
      summary: 'Create a wiki space',
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
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Space created',
          content: { 'application/json': { schema: spaceObject } },
        },
        '409': { description: 'Slug already taken' },
      },
    },
  },

  '/wiki/{org}/{team}/{space}/pages': {
    get: {
      tags: ['Wiki'],
      summary: 'List pages in a space',
      security: [{ bearerAuth: [] }],
      parameters: [...spaceParams],
      responses: {
        '200': {
          description: 'List of pages',
          content: {
            'application/json': {
              schema: { type: 'array', items: pageObject },
            },
          },
        },
        '404': { description: 'Space not found' },
      },
    },
    post: {
      tags: ['Wiki'],
      summary: 'Create a wiki page',
      security: [{ bearerAuth: [] }],
      parameters: [...spaceParams],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title', 'slug'],
              properties: {
                title: { type: 'string', minLength: 1, maxLength: 200 },
                slug: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9-]+$' },
                body: { type: 'string', maxLength: 500000, default: '' },
                parentId: { type: 'string' },
                isDraft: { type: 'boolean', default: false },
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Page created',
          content: { 'application/json': { schema: pageObject } },
        },
        '409': { description: 'Slug already taken in this space' },
      },
    },
  },

  '/wiki/{org}/{team}/{space}/{page}': {
    get: {
      tags: ['Wiki'],
      summary: 'Get a wiki page',
      security: [{ bearerAuth: [] }],
      parameters: [...pageParams],
      responses: {
        '200': {
          description: 'Page details',
          content: { 'application/json': { schema: pageObject } },
        },
        '404': { description: 'Page not found' },
      },
    },
    patch: {
      tags: ['Wiki'],
      summary: 'Update a wiki page',
      security: [{ bearerAuth: [] }],
      parameters: [...pageParams],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string', maxLength: 200 },
                body: { type: 'string', maxLength: 500000 },
                isDraft: { type: 'boolean' },
                changeDescription: { type: 'string', maxLength: 500 },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Updated page',
          content: { 'application/json': { schema: pageObject } },
        },
        '404': { description: 'Page not found' },
      },
    },
  },
};

registerPaths(paths);
