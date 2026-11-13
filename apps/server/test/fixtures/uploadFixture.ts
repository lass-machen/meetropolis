import http from 'node:http';
import { once } from 'node:events';
import type express from 'express';

/** Stream real HTTP requests without buffering the entire multipart body. */
export async function uploadTransport(app: express.Application) {
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local test port');
  const serverRequests: http.IncomingMessage[] = [];
  server.on('request', (req) => serverRequests.push(req));
  function open(route: string, headers: Record<string, string>) {
    const req = http.request({ host: '127.0.0.1', port: address.port, path: route, method: 'POST', headers });
    const result = new Promise<{ status: number; retryAfter: number }>((resolve, reject) => {
      req.once('response', (res) => {
        res.resume();
        res.once('end', () =>
          resolve({ status: res.statusCode ?? 0, retryAfter: Number(res.headers['retry-after'] ?? 0) }),
        );
      });
      req.once('error', reject);
    });
    // Close each open upload through its own request in finally.
    void result.catch(() => {});
    req.flushHeaders();
    return { req, result };
  }
  async function ready(count: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (
        serverRequests.length >= count &&
        serverRequests.slice(0, count).every((req) => req.listenerCount('data') > 0)
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('The actual upload parser did not become ready.');
  }
  async function close() {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  return { open, ready, close };
}

export async function writeBytes(req: http.ClientRequest, size: number, byte = 32) {
  const block = Buffer.alloc(64 * 1024, byte);
  let sent = 0;
  while (sent < size && !req.destroyed && !req.writableEnded) {
    const chunk = block.subarray(0, Math.min(block.length, size - sent));
    if (!req.write(chunk)) await once(req, 'drain');
    sent += chunk.length;
  }
}
