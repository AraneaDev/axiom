import type { oas31 } from 'zod-openapi';

/** What the error handler answers: `{ error: { message, code?, details? } }`. */
export const ERROR_SCHEMA: oas31.SchemaObject = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        code: { type: 'string' },
        details: {},
      },
      required: ['message'],
    },
  },
  required: ['error'],
};

const errorBody = (description: string): oas31.ResponseObject => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

/** The failures any action can answer, as components. */
export const ERROR_RESPONSES: Record<string, oas31.ResponseObject> = {
  BadRequest: errorBody('The input is not valid'),
  Unauthorized: errorBody('No valid session or token'),
  Forbidden: errorBody('The caller may not do this, or its token lacks the scope'),
  NotFound: errorBody('It does not exist, or the caller may not see it'),
  TooManyRequests: errorBody('A rate limit was reached'),
};

/** References to ERROR_RESPONSES by status, for an operation's responses. */
export const ERROR_RESPONSE_REFS: Record<string, oas31.ReferenceObject> = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '429': { $ref: '#/components/responses/TooManyRequests' },
};
