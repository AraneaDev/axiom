import { createHash } from 'crypto';

import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Every actions file the app mounts: the document is built from what they register
import '../../actions/read.actions';
import '../../modules/attachments/attachments.actions';
import '../../modules/issues/issues.actions';
import '../../modules/orgs/orgs.actions';
import '../../modules/projects/projects.actions';
import '../../modules/search/search.actions';
import '../../modules/sprints/sprints.actions';
import '../../modules/teams/teams.actions';
import '../../modules/wiki/wiki.actions';

import { listActions } from '../../actions/registry';

import { buildOpenApi, openApiPath } from './build';

type Json = Record<string, unknown>;
type Operation = {
  operationId: string;
  tags: string[];
  parameters?: Array<{ name: string; in: string; required?: boolean; schema: Json }>;
  requestBody?: { required?: boolean; content: Record<string, { schema: Json }> };
  responses: Record<string, Json>;
  [key: `x-${string}`]: unknown;
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Every operation of the document, with its path and method.
 * @param spec - The document
 */
function operations(spec: ReturnType<typeof buildOpenApi>) {
  return Object.entries(spec.paths ?? {}).flatMap(([path, item]) =>
    Object.entries(item as Record<string, Operation>)
      .filter(([method]) => METHODS.includes(method))
      .map(([method, operation]) => ({ path, method, operation })),
  );
}

/**
 * Every `$ref` below a node.
 * @param node - Any part of the document
 * @param found - Collects the references
 */
function collectRefs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((item) => collectRefs(item, found));
  else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') found.push(value);
      else collectRefs(value, found);
    }
  }
  return found;
}

/**
 * Follow a local reference through the document.
 * @param spec - The document
 * @param ref - A `#/...` pointer
 */
function resolve(spec: unknown, ref: string): unknown {
  return ref
    .slice(2)
    .split('/')
    .reduce<unknown>((node, key) => (node as Json | undefined)?.[key], spec);
}

describe('OpenAPI from the action registry', () => {
  let spec: ReturnType<typeof buildOpenApi>;
  let ops: ReturnType<typeof operations>;

  beforeAll(() => {
    spec = buildOpenApi();
    ops = operations(spec);
  });

  it('is an OpenAPI 3.1 document with paths and components', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('Axiom API');
    expect(Object.keys(spec.paths ?? {})).not.toHaveLength(0);
    expect(spec.components?.securitySchemes?.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(spec.components?.securitySchemes?.apiToken).toMatchObject({ type: 'apiKey' });
  });

  it('has one operation with the right method and path for every action with a binding', () => {
    const bound = listActions().filter((def) => def.rest);
    expect(bound.length).toBeGreaterThan(50);
    for (const def of bound) {
      const item = spec.paths?.[openApiPath(def.rest!.path)] as Record<string, Operation>;
      const operation = item?.[def.rest!.method.toLowerCase()];
      expect(operation, def.name).toBeDefined();
      expect(operation.operationId).toBe(def.name);
      expect(operation.tags).toEqual([def.area]);
      expect(operation['x-scope']).toBe(`${def.area}:${def.kind}`);
      expect(operation['x-ui-only'], def.name).toBe(def.uiOnly ? true : undefined);
    }
  });

  it('writes Express params as OpenAPI params and declares each one', () => {
    expect(openApiPath('/api/projects/:projectId/issues/:issueNumber')).toBe(
      '/api/projects/{projectId}/issues/{issueNumber}',
    );
    for (const { path, operation } of ops) {
      const templated = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      const declared = (operation.parameters ?? []).filter((p) => p.in === 'path');
      expect(declared.map((p) => p.name).sort(), path).toEqual([...templated].sort());
      expect(declared.every((p) => p.required === true)).toBe(true);
    }
  });

  it('gives every operation a unique operationId', () => {
    const ids = ops.map(({ operation }) => operation.operationId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no reference to a missing component, and no $defs or $schema left in a schema', () => {
    const refs = collectRefs(spec);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(resolve(spec, ref), ref).toBeDefined();
    const text = JSON.stringify(spec);
    expect(text).not.toContain('"$defs"');
    expect(text).not.toContain('"$schema"');
    expect(text).not.toContain('#/$defs');
  });

  it('gives a read its fields as query params and no body, and a write with a target a body', () => {
    const list = ops.find(({ operation }) => operation.operationId === 'issue.list')!.operation;
    expect(list.requestBody).toBeUndefined();
    expect(list.parameters!.filter((p) => p.in === 'query').length).toBeGreaterThan(0);

    const update = ops.find(({ operation }) => operation.operationId === 'issue.update')!;
    expect(update.operation.requestBody?.required).toBe(true);
    expect(update.operation.requestBody?.content['application/json']).toBeDefined();
    // The ids the path carries are not asked for again in the body
    const body = update.operation.requestBody!.content['application/json'].schema as {
      properties: Json;
    };
    expect(body.properties).not.toHaveProperty('projectId');
    expect(body.properties).not.toHaveProperty('issueNumber');
  });

  it('answers 204 for a delete, and documents a raw upload as multipart', () => {
    const del = ops.find(({ operation }) => operation.operationId === 'issue.delete')!;
    expect(del.operation.responses['204']).toBeDefined();
    const upload = ops.find(({ operation }) => operation.operationId === 'attachment.upload')!;
    expect(upload.operation.requestBody?.content['multipart/form-data']).toBeDefined();
  });

  it('publishes a .catch field as required, without a default it does not honour', () => {
    const update = ops.find(({ operation }) => operation.operationId === 'comment.update')!;
    const body = update.operation.requestBody!.content['application/json'].schema as {
      properties: { body: Json };
      required: string[];
    };
    expect(body.required).toContain('body');
    expect(body.properties.body).not.toHaveProperty('default');
    expect(JSON.stringify(spec.paths?.['/api/wiki/pages/{pageId}/linked-issues'])).not.toContain(
      '"default":""',
    );
  });

  it('keeps the recursive output of item.read as components', () => {
    const read = ops.find(({ operation }) => operation.operationId === 'item.read')!;
    expect(read.method).toBe('post');
    expect(collectRefs(read.operation)).toContain(
      '#/components/schemas/item.read.output.__schema0',
    );
  });

  it('documents the routes that are no actions', () => {
    const act = ops.find(({ path, method }) => path === '/api/act' && method === 'post');
    expect(act?.operation.requestBody?.content['application/json']).toBeDefined();
    expect(ops.find(({ path, method }) => path === '/api/mcp' && method === 'post')).toBeDefined();
    const upload = ops.find(
      ({ path, method }) => path === '/api/uploads/{uploadId}' && method === 'put',
    );
    expect(upload?.operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sig', in: 'query', required: true }),
      ]),
    );
    expect(upload?.operation['security']).toEqual([]);
  });

  describe('served by the app', () => {
    let app: Parameters<typeof request>[0];

    beforeAll(async () => {
      app = (await import('../../index')).default;
    });

    it('answers /api/openapi.json without a login', async () => {
      const res = await request(app).get('/api/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
      expect(Object.keys(res.body.paths)).toContain('/api/act');
    });

    it('answers /api/docs with a policy that lets the page run', async () => {
      const res = await request(app).get('/api/docs');
      expect(res.status).toBe(200);
      const html = res.text;
      const cdn = html.match(/<script src="(https:\/\/[^/"]+)[^"]*"/)?.[1];
      expect(cdn).toBeDefined();
      const inline = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)![1];
      const hash = `'sha256-${createHash('sha256').update(inline).digest('base64')}'`;
      const scriptSrc = String(res.headers['content-security-policy'])
        .split(';')
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith('script-src '))!;
      expect(scriptSrc).toContain("'self'");
      expect(scriptSrc).toContain(cdn);
      expect(scriptSrc).toContain(hash);
    });

    it('keeps the policy of every other page strict', async () => {
      const res = await request(app).get('/api/openapi.json');
      expect(String(res.headers['content-security-policy'])).toMatch(/script-src 'self'(;|$)/);
    });
  });
});
