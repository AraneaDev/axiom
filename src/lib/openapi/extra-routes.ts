import type { oas31 } from 'zod-openapi';

import { actRequest } from '../../actions/batch';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  searchSchema,
} from '../../utils/validation/common-validators';

import { ERROR_RESPONSE_REFS } from './errors';
import { jsonSchema, type SchemaStore } from './json-schema';

type PathItem = Record<string, oas31.OperationObject & Record<`x-${string}`, unknown>>;

const refs = (...statuses: Array<keyof typeof ERROR_RESPONSE_REFS>) =>
  Object.fromEntries(statuses.map((status) => [status, ERROR_RESPONSE_REFS[status]]));

/** One JSON-RPC 2.0 message, as the MCP transport takes it: a single one, never a batch. */
const JSON_RPC_MESSAGE: oas31.SchemaObject = {
  type: 'object',
  properties: {
    jsonrpc: { const: '2.0' },
    id: { type: ['string', 'number'] },
    method: { type: 'string' },
    params: { type: 'object' },
  },
  required: ['jsonrpc', 'method'],
};

/** What /api/mcp answers when it refuses outside a server: a JSON-RPC error with a null id. */
const JSON_RPC_ERROR: oas31.SchemaObject = {
  type: 'object',
  properties: {
    jsonrpc: { const: '2.0' },
    error: {
      type: 'object',
      properties: { code: { type: 'integer' }, message: { type: 'string' } },
      required: ['code', 'message'],
    },
    id: { type: 'null' },
  },
  required: ['jsonrpc', 'error', 'id'],
};

const jsonRpcError = (description: string): oas31.ResponseObject => ({
  description,
  content: { 'application/json': { schema: JSON_RPC_ERROR } },
});

const mcpRefused = (description: string): oas31.OperationObject => ({
  summary: 'Not offered: the endpoint answers POST only',
  tags: ['agent'],
  security: [{ apiToken: [] }],
  responses: {
    '401': { $ref: '#/components/responses/Unauthorized' },
    '403': { $ref: '#/components/responses/Forbidden' },
    '405': jsonRpcError(description),
  },
});

const json = (schema: oas31.SchemaObject): oas31.ContentObject => ({
  'application/json': { schema },
});

/** The tokens a login, registration or refresh hands out. */
const TOKENS: Record<string, oas31.SchemaObject> = {
  accessToken: { type: 'string' },
  refreshToken: { type: 'string' },
};

/**
 * Account routes that are no actions yet (plan 4 moves them). Bodies come from the schemas the
 * routes validate with.
 * @param store - The document's components
 */
function authPaths(store: SchemaStore): Record<string, PathItem> {
  const body = (
    schema: Parameters<typeof jsonSchema>[0],
    name: string,
  ): oas31.RequestBodyObject => ({
    required: true,
    content: json(jsonSchema(schema, 'input', `${name}.input`, store) as oas31.SchemaObject),
  });
  const user: oas31.SchemaObject = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      email: { type: 'string' },
      username: { type: 'string' },
      displayName: { type: 'string' },
    },
    required: ['id', 'email', 'username', 'displayName'],
  };
  return {
    '/api/auth/register': {
      post: {
        operationId: 'authRegister',
        summary: 'Create an account (an invite code, unless this is the first user)',
        tags: ['auth'],
        security: [],
        requestBody: body(registerSchema, 'authRegister'),
        responses: {
          '201': {
            description: 'The new user and a token pair',
            content: json({
              type: 'object',
              properties: { user, ...TOKENS },
              required: ['user', 'accessToken', 'refreshToken'],
            }),
          },
          ...refs('400', '403', '429'),
        },
      },
    },
    '/api/auth/login': {
      post: {
        operationId: 'authLogin',
        summary: 'Log in with an email or username and a password',
        description:
          'A user with two-factor authentication answers 401 with code TWO_FACTOR_REQUIRED until ' +
          '`twoFactorCode` is sent.',
        tags: ['auth'],
        security: [],
        requestBody: body(loginSchema, 'authLogin'),
        responses: {
          '200': {
            description: 'The user and a token pair',
            content: json({
              type: 'object',
              properties: { user, ...TOKENS },
              required: ['user', 'accessToken', 'refreshToken'],
            }),
          },
          ...refs('400', '401', '429'),
        },
      },
    },
    '/api/auth/refresh': {
      post: {
        operationId: 'authRefresh',
        summary: 'Trade a refresh token for a new token pair',
        tags: ['auth'],
        security: [],
        requestBody: body(refreshSchema, 'authRefresh'),
        responses: {
          '200': {
            description: 'A new token pair',
            content: json({
              type: 'object',
              properties: TOKENS,
              required: ['accessToken', 'refreshToken'],
            }),
          },
          ...refs('400', '401', '429'),
        },
      },
    },
    '/api/auth/logout': {
      post: {
        operationId: 'authLogout',
        summary: 'Log out, ending the given refresh token',
        tags: ['auth'],
        requestBody: {
          content: json({ type: 'object', properties: { refreshToken: { type: 'string' } } }),
        },
        responses: { '204': { description: 'No content' }, ...refs('401') },
      },
    },
    '/api/auth/forgot-password': {
      post: {
        operationId: 'authForgotPassword',
        summary: 'Ask for a password reset mail',
        tags: ['auth'],
        security: [],
        requestBody: body(forgotPasswordSchema, 'authForgotPassword'),
        responses: {
          '200': { description: 'Accepted', content: json({ type: 'object' }) },
          ...refs('400', '429'),
        },
      },
    },
    '/api/auth/reset-password': {
      post: {
        operationId: 'authResetPassword',
        summary: 'Set a new password with the token from the reset mail',
        tags: ['auth'],
        security: [],
        requestBody: body(resetPasswordSchema, 'authResetPassword'),
        responses: {
          '200': { description: 'The password was reset', content: json({ type: 'object' }) },
          ...refs('400', '429'),
        },
      },
    },
  };
}

/**
 * GET /api/search, which is no action yet (search.run is the action for agents).
 * @param store - The document's components
 */
function searchPaths(store: SchemaStore): Record<string, PathItem> {
  const query = jsonSchema(searchSchema, 'input', 'search.input', store) as {
    properties: Record<string, oas31.SchemaObject>;
    required?: string[];
  };
  return {
    '/api/search': {
      get: {
        operationId: 'searchGet',
        summary: 'Search issues and wiki pages the caller may see',
        description: 'A token only gets the sections its issues and wiki scopes cover.',
        tags: ['search'],
        parameters: Object.entries(query.properties).map(([name, schema]) => ({
          name,
          in: 'query' as const,
          required: query.required?.includes(name) ?? false,
          schema,
        })),
        responses: {
          '200': {
            description: 'One section per kind of result',
            content: json({
              type: 'array',
              items: {
                type: 'object',
                properties: { type: { enum: ['issues', 'wiki'] } },
                required: ['type'],
              },
            }),
          },
          ...refs('400', '401', '403', '429'),
        },
        'x-scope': 'search:read',
      },
    },
  };
}

/**
 * The routes that are no actions (account routes, search, signed uploads) and the ones that take
 * actions by name. The registry documents every action with a REST binding; these are routed by
 * hand.
 * @param store - The document's components
 */
export function extraPaths(store: SchemaStore): Record<string, PathItem> {
  return {
    ...authPaths(store),
    ...searchPaths(store),
    '/api/act': {
      post: {
        operationId: 'act',
        summary: 'Run one action or a batch of up to 25 by name, with the same checks as its route',
        description:
          'Give `action` and `input`, optionally a `key` such as AXM-42 instead of the id fields, ' +
          "or a `batch` of such items, run in order up to the first failure. Answers the action's " +
          'result, or `{ results, completed }` for a batch. Actions that only a browser session ' +
          'may run are not available here.',
        tags: ['agent'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: jsonSchema(actRequest, 'input', 'act.input', store) },
          },
        },
        responses: {
          '200': {
            description: 'The result of the action, or of the batch',
            content: { 'application/json': { schema: {} } },
          },
          ...refs('400', '401', '403', '404', '429'),
        },
      },
    },
    '/api/mcp': {
      post: {
        operationId: 'mcp',
        summary: 'MCP over Streamable HTTP, one JSON-RPC message per request',
        description:
          'Takes API tokens only (`Authorization: Token <token>`), so that every write carries ' +
          "the token's name. A browser origin other than the configured site is refused.",
        tags: ['agent'],
        security: [{ apiToken: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: JSON_RPC_MESSAGE } },
        },
        responses: {
          '200': {
            description: 'The JSON-RPC response',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '202': { description: 'A notification or a response was accepted; no body' },
          '400': jsonRpcError('The body is not one JSON-RPC message'),
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '415': jsonRpcError('The body is not application/json'),
          '429': { $ref: '#/components/responses/TooManyRequests' },
        },
      },
      get: { operationId: 'mcpStream', ...mcpRefused('There is no server stream') },
      delete: { operationId: 'mcpSession', ...mcpRefused('There are no sessions to end') },
    },
    '/api/uploads/{uploadId}': {
      put: {
        operationId: 'signedUpload',
        summary: 'Send the bytes of a file to a URL from attachment.createUploadUrl',
        description:
          'The signature in the URL is the credential: no session or token is sent. The body is ' +
          'the file itself, with the content type that was signed for, and the URL works once.',
        tags: ['files'],
        security: [],
        parameters: [
          { name: 'uploadId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'sig', in: 'query', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
        },
        responses: {
          '201': {
            description: 'The stored attachment',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          ...refs('400', '403', '429'),
          '413': { description: 'The body is larger than the URL allows' },
          '415': {
            description: 'The content type is not the signed one, or the body is compressed',
          },
        },
      },
    },
  };
}
