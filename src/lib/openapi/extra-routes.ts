import type { oas31 } from 'zod-openapi';

import { actRequest } from '../../actions/batch';

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

const mcpRefused = (description: string): oas31.OperationObject => ({
  summary: 'Not offered: the endpoint answers POST only',
  tags: ['agent'],
  security: [{ apiToken: [] }],
  responses: { '405': { description } },
});

/**
 * The routes that are no actions, and the ones that take actions by name. The registry router
 * documents every action with a REST binding; these four are routed by hand.
 * @param store - The document's components
 */
export function extraPaths(store: SchemaStore): Record<string, PathItem> {
  return {
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
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '415': {
            description: 'The body is not application/json',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
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
