/**
 * Child-process fixture for requestTelemetry.test.ts.
 *
 * Builds a real Express app with the real metricsMiddleware and the real
 * requestLogger, fires three real HTTP requests via supertest, then writes
 * exactly one JSON result line to stdout. The pino log lines are the
 * middleware's own stdout output and are parsed by the parent test;
 * nothing is synthesized here.
 */
import express from 'express';
import request from 'supertest';
import { metricsMiddleware, registry } from '../../src/metrics.js';
import { requestLogger } from '../../src/api/requestLogger.js';

const RESULT_MARKER = 'qdisc12-telemetry-result';

interface CaseResult {
  key: string;
  status: number;
}

interface RouteLabel {
  labels: Record<string, string>;
  value: number;
}

function buildApp(): express.Application {
  const app = express();
  app.use(metricsMiddleware());
  app.use(requestLogger);
  app.get('/invites/:code', (_req, res) => {
    res.status(200).type('text/plain').send('ok');
  });
  const api = express.Router();
  api.get('/invites/:code', (_req, res) => {
    res.status(200).type('text/plain').send('ok');
  });
  app.use('/api', api);
  return app;
}

async function readRouteLabels(): Promise<RouteLabel[]> {
  const metric = registry.getSingleMetric('meetropolis_http_request_duration_seconds');
  if (!metric) {
    throw new Error('Metrik meetropolis_http_request_duration_seconds fehlt im Registry');
  }
  const data = (await metric.get()) as { values: RouteLabel[] };
  return data.values;
}

async function waitForObservations(expected: number): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const values = await readRouteLabels();
    const count = values
      .filter((v) => v.labels['method'] === 'GET' && v.labels['le'] === '+Inf')
      .reduce((sum, v) => sum + v.value, 0);
    if (count >= expected) return;
    if (Date.now() > deadline) {
      throw new Error(`only ${count} of ${expected} metric observations after 5 seconds`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function main(): Promise<void> {
  const app = buildApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const address = server.address();
  if (typeof address !== 'object' || address === null || typeof address.port !== 'number') {
    throw new Error('ephemeral server reported no usable address');
  }
  const agent = request(`http://127.0.0.1:${address.port}`);
  const cases: CaseResult[] = [];
  try {
    const a = await agent.get('/invites/QDISC12_CODE?x=y').set('x-correlation-id', 'qdisc12-a');
    cases.push({ key: 'plain-param', status: a.status });
    const b = await agent.get('/missing/QDISC12_MISS?x=y').set('x-correlation-id', 'qdisc12-b');
    cases.push({ key: 'unmatched', status: b.status });
    const c = await agent.get('/api/invites/QDISC12_MOUNT?x=y').set('x-correlation-id', 'qdisc12-c');
    cases.push({ key: 'mounted-param', status: c.status });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await waitForObservations(3);
  const metricValues = await readRouteLabels();
  process.stdout.write(`${JSON.stringify({ marker: RESULT_MARKER, cases, metricValues })}\n`);
  // main returns; with no open handles the process exits naturally while
  // stdout fully drains.
}

void main();
