import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Every actions file the app mounts: the document is built from what they register
import '../../actions/read.actions';
import '../../modules/attachments/attachments.actions';
import '../../modules/issues/issues.actions';
import '../../modules/orgs/orgs.actions';
import '../../modules/projects/projects.actions';
import '../../modules/roadmap/roadmap.actions';
import '../../modules/search/search.actions';
import '../../modules/sprints/sprints.actions';
import '../../modules/teams/teams.actions';
import '../../modules/wiki/wiki.actions';

import { listActions } from '../../actions/registry';
import { listenForRawRequests, rawRequest } from '../../test/raw-request';

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

  it('documents login, registration, refresh, logout and search with their schemas', () => {
    const find = (path: string, method: string) =>
      ops.find((op) => op.path === path && op.method === method)?.operation;
    const login = find('/api/auth/login', 'post')!;
    const loginBody = login.requestBody!.content['application/json'].schema as {
      required: string[];
    };
    expect(loginBody.required).toEqual(expect.arrayContaining(['login', 'password']));
    expect(login['security']).toEqual([]);
    expect(find('/api/auth/register', 'post')).toBeDefined();
    expect(find('/api/auth/refresh', 'post')).toBeDefined();
    expect(find('/api/auth/logout', 'post')!['security']).toBeUndefined();
    const search = find('/api/search', 'get')!;
    expect(search.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'q', in: 'query', required: true })]),
    );
  });

  it('documents what /api/mcp answers in its own error shape', () => {
    const mcp = (method: string) =>
      ops.find((op) => op.path === '/api/mcp' && op.method === method)!.operation;
    for (const method of ['get', 'delete']) {
      expect(Object.keys(mcp(method).responses).sort()).toEqual(['401', '403', '405']);
    }
    for (const status of ['400', '415']) {
      const response = mcp('post').responses[status] as {
        content: Record<string, { schema: Json }>;
      };
      expect(response.content['application/json'].schema).toMatchObject({
        required: ['jsonrpc', 'error', 'id'],
      });
    }
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

    it('answers /api/docs with no third-party script, in the page or in its policy', async () => {
      const res = await request(app).get('/api/docs');
      expect(res.status).toBe(200);
      const html = res.text;
      expect(html).not.toMatch(/https?:\/\//);
      const sources = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]);
      expect(sources).toEqual(['/api/docs/assets/standalone.js']);
      const inline = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)![1];
      const hash = `'sha256-${createHash('sha256').update(inline).digest('base64')}'`;
      const scriptSrc = String(res.headers['content-security-policy'])
        .split(';')
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith('script-src '))!;
      expect(scriptSrc.split(' ').slice(1)).toEqual(["'self'", hash]);
    });

    it('serves the Scalar bundle from the app itself', async () => {
      const res = await request(app).get('/api/docs/assets/standalone.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
    });

    it('answers 404 for a docs asset that does not exist, not the docs page', async () => {
      for (const asset of ['nope.js', 'chunks/nope.js', 'nope/']) {
        const res = await request(app).get(`/api/docs/assets/${asset}`);
        expect(res.status, asset).toBe(404);
        expect(res.text, asset).not.toContain('<html');
      }
    });

    it('serves nothing outside the docs assets, however the path is spelled', async () => {
      const server = await listenForRawRequests(app);
      try {
        for (const target of [
          '/api/docs/assets/../../package.json',
          '/api/docs/assets/%2e%2e/%2e%2e/package.json',
          '/api/docs/assets/..%2f..%2fpackage.json',
        ]) {
          const res = await rawRequest(server, 'GET', target, '');
          expect(res.status, target).toBe(404);
          expect(JSON.stringify(res.body), target).not.toContain('"dependencies"');
        }
      } finally {
        server.close();
      }
    });

    it('pins the docs bundle exactly, as a build time dependency', () => {
      const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
      expect(pkg.dependencies['@scalar/api-reference']).toBeUndefined();
      expect(pkg.devDependencies['@scalar/api-reference']).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('keeps the policy of every other page strict', async () => {
      const res = await request(app).get('/api/openapi.json');
      expect(String(res.headers['content-security-policy'])).toMatch(/script-src 'self'(;|$)/);
    });
  });
});
