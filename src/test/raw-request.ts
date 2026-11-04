import type { Server } from 'http';
import net from 'net';
import type { AddressInfo } from 'net';

import type { Express } from 'express';

/**
 * Listen on a free port for raw requests. Close the server after the tests.
 * @param app - The app to serve
 */
export function listenForRawRequests(app: Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

/**
 * Send a request over a plain socket, with the request target exactly as given. HTTP clients
 * such as supertest strip a fragment before sending, so they can't test how one is handled.
 * @param server - From listenForRawRequests
 * @param method - The HTTP method
 * @param target - The request target, sent byte for byte
 * @param authorization - The Authorization header
 * @param body - A JSON body
 * @returns The status and the parsed body, if there is one
 */
export function rawRequest(
  server: Server,
  method: string,
  target: string,
  authorization: string,
  body?: unknown,
): Promise<{ status: number; body: { error?: { code?: string; message?: string } } }> {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const lines = [
    `${method} ${target} HTTP/1.1`,
    'Host: localhost',
    `Authorization: ${authorization}`,
    'X-Requested-With: XMLHttpRequest',
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(payload)}`,
    'Connection: close',
  ];

  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`${lines.join('\r\n')}\r\n\r\n${payload}`);
    });
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      received += chunk;
    });
    socket.on('error', reject);
    socket.on('end', () => {
      const separator = received.indexOf('\r\n\r\n');
      const status = Number(received.split(' ')[1]);
      const text = received.slice(separator + 4);
      let parsed = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        // HEAD, 204 and the like have no JSON to read
      }
      resolve({ status, body: parsed });
    });
  });
}
