import { z } from 'zod';
import type { oas31 } from 'zod-openapi';

import type { ActionDef, RestBinding } from '../../actions/define';
import { listActions } from '../../actions/registry';

import { ERROR_RESPONSE_REFS, ERROR_RESPONSES, ERROR_SCHEMA } from './errors';
import { extraPaths } from './extra-routes';
import { jsonSchema, type JsonSchema, type SchemaStore } from './json-schema';

type Operation = oas31.OperationObject & Record<`x-${string}`, unknown>;
type HttpMethod = Lowercase<RestBinding['method']>;

const SUCCESS_BY_METHOD: Record<RestBinding['method'], number> = {
  GET: 200,
  POST: 201,
  PUT: 200,
  PATCH: 200,
  DELETE: 200,
};

/**
 * A binding's path in OpenAPI's form: `:id` becomes `{id}`.
 * @param path - The Express path
 */
export function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

/**
 * The names of a path's params.
 * @param path - The Express path
 */
function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
}

/**
 * What a schema says about its fields, split into the path's params and everything else.
 * @param input - The input schema as JSON
 * @param paramNames - The path's param names
 */
function splitInput(input: JsonSchema, paramNames: string[]) {
  const properties = (input.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((input.required ?? []) as string[]);
  const rest = Object.fromEntries(
    Object.entries(properties).filter(([name]) => !paramNames.includes(name)),
  );
  const restRequired = [...required].filter((name) => name in rest);
  return { properties, required, rest, restRequired };
}

/**
 * The body schema: the input without the fields the path carries.
 * @param input - The input schema as JSON
 * @param rest - The properties left
 * @param restRequired - The required ones among them
 */
function bodySchema(input: JsonSchema, rest: Record<string, JsonSchema>, restRequired: string[]) {
  const { properties: _p, required: _r, ...others } = input;
  return {
    ...others,
    properties: rest,
    ...(restRequired.length ? { required: restRequired } : {}),
  };
}

/**
 * The success response of an action.
 * @param def - The action
 * @param binding - Its REST binding
 * @param store - Where schemas of the document are collected
 */
function successResponse(
  def: ActionDef,
  binding: RestBinding,
  store: SchemaStore,
): Record<string, oas31.ResponseObject> {
  const status = binding.status ?? SUCCESS_BY_METHOD[binding.method];
  if (binding.raw) {
    // The handler answers on the raw response, so its output schema says nothing about the body
    return binding.method === 'GET'
      ? {
          [status]: {
            description: 'The file or export itself; the handler answers on the raw response.',
            content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
          },
        }
      : {
          [status]: {
            description: 'The handler answers on the raw response with the stored record.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        };
  }
  const isVoid = (def.output as z.ZodType)._zod.def.type === 'void';
  if (isVoid) {
    const empty = status === 204 || binding.method === 'DELETE';
    return { [empty ? 204 : status]: { description: 'No content' } };
  }
  return {
    [status]: {
      description: 'Success',
      content: {
        'application/json': {
          schema: jsonSchema(def.output, 'output', `${def.name}.output`, store),
        },
      },
    },
  };
}

/**
 * One operation, from an action with a REST binding.
 * @param def - The action
 * @param binding - Its REST binding
 * @param store - Where schemas of the document are collected
 */
function operationFor(def: ActionDef, binding: RestBinding, store: SchemaStore): Operation {
  const paramNames = pathParamNames(binding.path);
  const input = jsonSchema(def.input, 'input', `${def.name}.input`, store);
  const { properties, required, rest, restRequired } = splitInput(input, paramNames);
  const isRead = binding.method === 'GET';

  const parameters: oas31.ParameterObject[] = paramNames.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: properties[name] ?? { type: 'string' },
  }));

  let requestBody: oas31.RequestBodyObject | undefined;
  if (isRead) {
    for (const [name, schema] of Object.entries(rest)) {
      parameters.push({ name, in: 'query', required: required.has(name), schema });
    }
  } else if (binding.raw) {
    // A raw write is the multipart upload: the fields are form parts next to the file
    requestBody = {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: { ...rest, file: { type: 'string', format: 'binary' } },
            required: ['file', ...restRequired],
          },
        },
      },
    };
  } else if (!binding.emptyBody && (Object.keys(rest).length > 0 || def.target)) {
    requestBody = {
      // A binding with a target answers 400 for a missing body, however few fields are required
      required: !!def.target || restRequired.length > 0,
      content: { 'application/json': { schema: bodySchema(input, rest, restRequired) } },
    };
  }

  const description = def.uiOnly
    ? 'Only for a browser session: a token or MCP is refused.'
    : def.tokenBlocked
      ? 'Refused to every token and to MCP until approvals exist.'
      : def.admin
        ? "A token's call always waits for a person to approve it, whatever the policy says."
        : undefined;

  return {
    operationId: def.name,
    summary: def.summary,
    ...(description ? { description } : {}),
    tags: [def.area],
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: {
      ...successResponse(def, binding, store),
      ...ERROR_RESPONSE_REFS,
    },
    'x-scope': `${def.area}:${def.kind}`,
    ...(def.uiOnly ? { 'x-ui-only': true } : {}),
    ...(def.tokenBlocked ? { 'x-token-blocked': true } : {}),
    ...(def.admin ? { 'x-admin': true } : {}),
    ...(def.destructive || def.destructiveWhen ? { 'x-destructive': true } : {}),
  };
}

/**
 * The OpenAPI 3.1 document of the API, built from the action registry: one operation per action
 * with a REST binding, with the routes that are no actions (/api/act, /api/mcp, signed uploads).
 * Schemas come from the actions' own Zod schemas, so the document cannot drift from what runs.
 */
export function buildOpenApi(): oas31.OpenAPIObject {
  const store: SchemaStore = { schemas: { Error: ERROR_SCHEMA as JsonSchema } };
  const paths: Record<string, Record<string, Operation>> = {};
  const areas = new Set<string>();

  for (const def of listActions()) {
    const binding = def.rest;
    if (!binding) continue;
    const path = openApiPath(binding.path);
    const method = binding.method.toLowerCase() as HttpMethod;
    paths[path] ??= {};
    paths[path][method] = operationFor(def, binding, store);
    areas.add(def.area);
  }
  for (const [path, item] of Object.entries(extraPaths(store))) {
    paths[path] = { ...paths[path], ...item };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Axiom API',
      version: '1.0.0',
      description:
        'REST API of Axiom, generated from the action registry. Every operation id is an action ' +
        'name, which /api/act and the MCP server take as well. x-scope is the token scope an ' +
        'action needs.',
    },
    servers: [{ url: '/', description: 'API base path' }],
    tags: [...areas].sort().map((name) => ({ name })),
    security: [{ bearerAuth: [] }, { apiToken: [] }],
    paths: paths as oas31.PathsObject,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiToken: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'An API token, sent as `Token <token>`.',
        },
      },
      schemas: store.schemas as Record<string, oas31.SchemaObject>,
      responses: ERROR_RESPONSES,
    },
  };
}
