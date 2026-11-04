import http from 'http';
import type { AddressInfo } from 'net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertPublicUrl, executeWebhook, type PublicRequestDeps } from './webhook';

describe('executeWebhook', () => {
  let server: http.Server;
  let base: string;
  let other: http.Server;
  let otherBase: string;
  const seen: Array<{ url?: string; method?: string; secret?: string; body: string }> = [];

  const record = (req: http.IncomingMessage, onEnd: () => void) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
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
          '/see-other': [302, '/end'],
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

  it('repeats the request on a 307 and turns it into a GET on a 302', async () => {
    await send('/keep');
    expect(seen[1]).toEqual({ url: '/end', method: 'POST', secret: 's3', body: '{"a":1}' });
    await send('/see-other');
    expect(seen[1]).toEqual({ url: '/end', method: 'GET', secret: 's3', body: '' });
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
