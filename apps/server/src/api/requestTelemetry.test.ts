/**
 * Route metadata in request logs and metric labels (Q-DISC-12).
 *
 * Runs test/fixtures/requestTelemetry.ts exactly once as a real Node
 * subprocess and asserts only on its real output: pino log lines plus one
 * JSON result line. Expects: http.request without a path field,
 * response/label path as baseUrl plus route template ("/api/invites/:code"
 * for mounts, "<unmatched>" without a match), no concrete parameters,
 * identifiers or query strings in logs or labels.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '../../test/fixtures/requestTelemetry.ts');
const RESULT_MARKER = 'qdisc12-telemetry-result';
const LEAKS = ['QDISC12_CODE', 'QDISC12_MISS', 'QDISC12_MOUNT', '?x=y'];

interface LogLine {
  event?: string;
  id?: string;
  method?: string;
  path?: string;
  status?: number;
}

interface MetricValue {
  labels: Record<string, string>;
  value: number;
}

interface FixtureOutput {
  logs: LogLine[];
  cases: { key: string; status: number }[];
  metricValues: MetricValue[];
}

function runFixture(): FixtureOutput {
  const run = spawnSync(process.execPath, ['--import', 'tsx', fixture], {
    cwd: path.resolve(here, '..'),
    encoding: 'utf8',
    timeout: 120000,
  });
  expect(run.error).toBeUndefined();
  expect(run.status).toBe(0);
  const logs: LogLine[] = [];
  let cases: FixtureOutput['cases'] | null = null;
  let metricValues: MetricValue[] | null = null;
  for (const line of String(run.stdout).split('\n')) {
    if (!line.startsWith('{')) continue;
    const parsed = JSON.parse(line) as LogLine & {
      marker?: string;
      cases?: FixtureOutput['cases'];
      metricValues?: MetricValue[];
    };
    if (parsed.marker === RESULT_MARKER) {
      cases = parsed.cases ?? null;
      metricValues = parsed.metricValues ?? null;
    } else if (typeof parsed.event === 'string') {
      logs.push(parsed);
    }
  }
  expect(cases).not.toBeNull();
  expect(metricValues).not.toBeNull();
  return { logs, cases: cases as FixtureOutput['cases'], metricValues: metricValues as MetricValue[] };
}

function findLog(logs: LogLine[], id: string, event: string): LogLine {
  const found = logs.find((l) => l.id === id && l.event === event);
  expect(found).toBeDefined();
  return found as LogLine;
}

let output: FixtureOutput;

beforeAll(() => {
  output = runFixture();
});

describe('request route metadata', () => {
  it('omits the path field from pending request entries', () => {
    expect(output.cases.map((c) => c.status)).toEqual([200, 404, 200]);
    for (const id of ['qdisc12-a', 'qdisc12-b', 'qdisc12-c']) {
      const entry = findLog(output.logs, id, 'http.request');
      expect(entry.method).toBe('GET');
      expect(entry).not.toHaveProperty('path');
    }
  });

  it('reports the route template for a matched response', () => {
    const response = findLog(output.logs, 'qdisc12-a', 'http.response');
    expect(response.method).toBe('GET');
    expect(response.status).toBe(200);
    expect(response.path).toBe('/invites/:code');
  });

  it('reports <unmatched> for a response without route match', () => {
    const response = findLog(output.logs, 'qdisc12-b', 'http.response');
    expect(response.method).toBe('GET');
    expect(response.status).toBe(404);
    expect(response.path).toBe('<unmatched>');
  });

  it('reports the mount prefix plus route template for a mounted response', () => {
    const response = findLog(output.logs, 'qdisc12-c', 'http.response');
    expect(response.method).toBe('GET');
    expect(response.status).toBe(200);
    expect(response.path).toBe('/api/invites/:code');
  });

  it('labels metrics with only the three route templates', () => {
    const routes = output.metricValues
      .filter((v) => v.labels['method'] === 'GET' && v.labels['le'] === '+Inf')
      .map((v) => v.labels['route']);
    expect(routes.length).toBeGreaterThan(0);
    expect(new Set(routes)).toEqual(new Set(['/invites/:code', '<unmatched>', '/api/invites/:code']));
  });

  it('leaks no concrete identifiers or query strings into logs or labels', () => {
    const haystacks = [JSON.stringify(output.logs), JSON.stringify(output.metricValues.map((v) => v.labels))];
    for (const haystack of haystacks) {
      for (const leak of LEAKS) {
        expect(haystack).not.toContain(leak);
      }
    }
  });
});
