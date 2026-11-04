import http from 'http';
import type { AddressInfo } from 'net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cleanupTestContext, createTestContext } from '../../test/factory';
import { authPost } from '../../test/helpers';

import { createRule, updateRule } from './automation.service';
import { assertPublicUrl, executeWebhook, type PublicRequestDeps } from './webhook';

describe('executeWebhook', () => {
  let server: http.Server;
  let base: string;
  let other: http.Server;
  let otherBase: string;
  const seen: Array<{ url?: string; method?: string; secret?: string; body: string }> = [];
  let lastHeaders: http.IncomingHttpHeaders = {};

  const record = (req: http.IncomingMessage, onEnd: () => void) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      lastHeaders = req.headers;
      seen.push({
        url: req.url,
        method: req.method,
        secret: req.headers['x-secret'] as string | undefined,
        body,
      });
      onEnd();
    });
  };

  // Local servers, which the real guard refuses: these two pass and anything else meets it
  const deps: Partial<PublicRequestDeps> = {
    checkUrl: async (url) => {
      if (url.startsWith(base) || url.startsWith(otherBase)) return;
      await assertPublicUrl(url);
    },
    open: (url, { method, headers, body, signal }) =>
      new Promise((resolve, reject) => {
        http
          .request(url, { method, headers, signal, agent: false }, resolve)
          .on('error', reject)
          .end(body);
      }),
  };

  beforeAll(async () => {
    other = http.createServer((req, res) => record(req, () => res.end()));
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    otherBase = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;

    server = http.createServer((req, res) => {
      record(req, () => {
        const redirects: Record<string, [number, string]> = {
          '/to-private': [302, 'https://127.0.0.1/secret'],
          '/to-metadata': [307, 'https://169.254.169.254/latest/meta-data'],
          '/to-http': [302, 'http://example.com/x'],
          '/loop': [302, '/loop'],
          '/moved': [301, '/end'],
          '/found': [302, '/end'],
          '/see-other': [303, '/end'],
          '/not-a-redirect': [300, '/end'],
          '/keep': [307, '/end'],
          '/elsewhere': [307, `${otherBase}/end`],
        };
        const redirect = redirects[req.url ?? ''];
        if (redirect) res.writeHead(redirect[0], { Location: redirect[1] });
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    for (const s of [server, other]) {
      s.closeAllConnections();
      s.close();
    }
  });

  const send = (path: string, method = 'POST') => {
    seen.length = 0;
    return executeWebhook(`${base}${path}`, { a: 1 }, method, { 'X-Secret': 's3' }, deps);
  };

  it('refuses a redirect to a private address', async () => {
    await expect(send('/to-private')).rejects.toMatchObject({ statusCode: 400 });
    await expect(send('/to-metadata')).rejects.toMatchObject({ statusCode: 400 });
    expect(seen.map((hit) => hit.url)).toEqual(['/to-metadata']);
  });

  it('refuses a redirect to plain HTTP', async () => {
    await expect(send('/to-http')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('caps the hops', async () => {
    await expect(send('/loop')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Webhook URL redirected too many times',
    });
    expect(seen).toHaveLength(6);
  });

  it('delivers the body and the headers', async () => {
    await send('/end');
    expect(seen).toEqual([{ url: '/end', method: 'POST', secret: 's3', body: '{"a":1}' }]);
  });

  // The rules of HTTP-redirect fetch in the Fetch standard
  it.each([
    ['/moved', 'POST', 'GET', ''],
    ['/found', 'POST', 'GET', ''],
    ['/moved', 'PUT', 'PUT', '{"a":1}'],
    ['/found', 'PUT', 'PUT', '{"a":1}'],
    ['/moved', 'HEAD', 'HEAD', ''],
    ['/found', 'DELETE', 'DELETE', '{"a":1}'],
    ['/see-other', 'POST', 'GET', ''],
    ['/see-other', 'PUT', 'GET', ''],
    ['/see-other', 'DELETE', 'GET', ''],
    ['/see-other', 'HEAD', 'HEAD', ''],
    ['/see-other', 'GET', 'GET', ''],
    ['/keep', 'POST', 'POST', '{"a":1}'],
  ])('on %s a %s arrives as %s', async (path, sent, arrives, body) => {
    await send(path, sent);
    expect(seen[1]).toMatchObject({ url: '/end', method: arrives, secret: 's3', body });
  });

  it('does not follow a 3xx that is not a redirect status', async () => {
    await send('/not-a-redirect');
    expect(seen.map((hit) => hit.url)).toEqual(['/not-a-redirect']);
  });

  it('delivers a body with every method that has one', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await send('/end', method);
      expect(seen[0]).toMatchObject({ method, body: '{"a":1}' });
    }
  });

  it.each(['TRACE', 'CONNECT', 'OPTIONS', '', 'PO ST'])(
    'refuses the method "%s"',
    async (method) => {
      await expect(send('/end', method)).rejects.toMatchObject({ statusCode: 400 });
      expect(seen).toEqual([]);
    },
  );

  it.each([[5], [null], [{}], [['GET']]])('fails cleanly on the method %j', async (method) => {
    seen.length = 0;
    await expect(
      executeWebhook(`${base}/end`, {}, method as never, undefined, deps),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(seen).toEqual([]);
  });

  it('drops headers that are for the client to decide', async () => {
    seen.length = 0;
    await executeWebhook(
      `${base}/end`,
      { a: 1 },
      'DELETE',
      {
        'Transfer-Encoding': 'chunked',
        connection: 'upgrade',
        HOST: 'internal.example',
        'content-length': '1',
        'X-Secret': 'kept',
      },
      deps,
    );
    expect(seen[0]).toMatchObject({ secret: 'kept', body: '{"a":1}' });
    expect(lastHeaders['transfer-encoding']).toBeUndefined();
    expect(lastHeaders['content-length']).toBe('7');
    expect(lastHeaders.host).not.toBe('internal.example');
  });

  it('accepts a method in any case', async () => {
    await send('/end', 'post');
    expect(seen[0]).toMatchObject({ method: 'POST' });
  });

  it('checks the method when a rule is saved', async () => {
    const ctx = await createTestContext(`webhook${Date.now()}`);
    const rule = (method: string) => ({
      name: 'r',
      trigger: 'issue:created' as const,
      actions: [{ type: 'webhook' as const, url: 'https://example.com/x', method }],
    });
    await expect(createRule(ctx.projectId, rule('TRACE'))).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(createRule(ctx.projectId, rule(''))).rejects.toMatchObject({ statusCode: 400 });
    for (const method of [5, null, {}, ['GET']]) {
      const res = await authPost(
        `/api/projects/${ctx.projectId}/automation-rules`,
        ctx.owner.token,
        rule(method as never),
      );
      expect({ method, status: res.status }).toEqual({ method, status: 400 });
    }
    const saved = await createRule(ctx.projectId, rule('POST'));
    await expect(updateRule(saved.id, rule('TRACE'))).rejects.toMatchObject({ statusCode: 400 });
    await cleanupTestContext(ctx);
  });

  it('does not send its headers to another origin', async () => {
    await send('/elsewhere');
    expect(seen[1]).toEqual({ url: '/end', method: 'POST', body: '{"a":1}' });
  });

  it('connects through the pinned lookup, whatever checkUrl let through', async () => {
    await expect(
      executeWebhook('https://localhost:1/x', {}, 'POST', undefined, { checkUrl: async () => {} }),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('private') });
  });

  it('sends no body with a GET', async () => {
    await send('/end', 'GET');
    expect(seen[0]).toMatchObject({ method: 'GET', body: '' });
  });
});
