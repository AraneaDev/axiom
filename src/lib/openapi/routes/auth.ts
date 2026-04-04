import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { registerPaths } from '../registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Schema = Record<string, any>;

const tokenResponse: Schema = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    user: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        username: { type: 'string' },
        email: { type: 'string' },
        displayName: { type: 'string' },
      },
    },
  },
};

const paths: ZodOpenApiPathsObject = {
  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register a new user',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['username', 'email', 'password'],
              properties: {
                username: { type: 'string', minLength: 3, maxLength: 50 },
                email: { type: 'string', format: 'email' },
                password: { type: 'string', minLength: 8 },
                displayName: { type: 'string', maxLength: 100 },
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'User registered successfully',
          content: { 'application/json': { schema: tokenResponse } },
        },
        '409': { description: 'Username or email already taken' },
        '422': { description: 'Validation error' },
      },
    },
  },

  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Authenticate with username/email and password',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['login', 'password'],
              properties: {
                login: { type: 'string', description: 'Username or email' },
                password: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Login successful',
          content: { 'application/json': { schema: tokenResponse } },
        },
        '401': { description: 'Invalid credentials' },
        '429': { description: 'Too many attempts' },
      },
    },
  },

  '/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Refresh access token',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['refreshToken'],
              properties: {
                refreshToken: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'New access token issued',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  accessToken: { type: 'string' },
                },
              },
            },
          },
        },
        '401': { description: 'Invalid or expired refresh token' },
      },
    },
  },

  '/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Revoke the current session',
      security: [{ bearerAuth: [] }],
      responses: {
        '204': { description: 'Logged out' },
        '401': { description: 'Not authenticated' },
      },
    },
  },
};

registerPaths(paths);
