/**
 * Dedicated scrape listener for Prometheus.
 *
 * The public Express app always answers GET/HEAD /metrics with 404. This
 * module binds an optional second HTTP server that serves only those two
 * methods on /metrics. Unset METRICS_PORT leaves the listener off. The
 * default host is loopback; Docker compose sets METRICS_HOST to the
 * container interface and does not publish the port to the host.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { logger } from '../logger.js';
import { registry } from '../metrics.js';

const DEFAULT_HOST = '127.0.0.1';

export type MetricsBind = { listen: false } | { listen: true; port: number; host: string };

export interface MetricsServer {
  readonly address: AddressInfo;
  close(): Promise<void>;
}

export function resolveMetricsBind(env: NodeJS.ProcessEnv, publicPort: number): MetricsBind {
  const rawPort = env.METRICS_PORT;
  if (rawPort === undefined || rawPort.trim() === '') {
    return { listen: false };
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('METRICS_PORT is not a valid TCP port');
  }
  if (port === publicPort) {
    throw new Error('METRICS_PORT must differ from PORT');
  }
  const rawHost = env.METRICS_HOST;
  const host = rawHost === undefined || rawHost.trim() === '' ? DEFAULT_HOST : rawHost.trim();
  return { listen: true, port, host };
}

function requestPath(url: string | undefined): string {
  if (url === undefined) return '';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

async function sendMetrics(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await registry.metrics();
    res.statusCode = 200;
    res.setHeader('Content-Type', registry.contentType);
    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', Buffer.byteLength(body));
      res.end();
      return;
    }
    res.end(body);
  } catch {
    res.statusCode = 500;
    res.end('metrics error');
  }
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const method = req.method ?? '';
  if ((method === 'GET' || method === 'HEAD') && requestPath(req.url) === '/metrics') {
    void sendMetrics(req, res).catch(() => {
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end();
      }
    });
    return;
  }
  res.statusCode = 404;
  res.end();
}

export function startMetricsServer(bind: { port: number; host: string }): Promise<MetricsServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleRequest);
    const fail = (err: Error): void => {
      server.close();
      reject(err);
    };
    server.once('error', fail);
    server.listen(bind.port, bind.host, () => {
      server.off('error', fail);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        fail(new Error('metrics listener bound without a TCP address'));
        return;
      }
      server.on('error', (err) => {
        logger.error('metrics listener error', err);
      });
      resolve({
        address,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((closeErr) => {
              if (closeErr) closeReject(closeErr);
              else closeResolve();
            });
          }),
      });
    });
  });
}
