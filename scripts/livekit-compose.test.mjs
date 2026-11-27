import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';

function renderCompose(files, overrides = {}) {
  const prefix = join(tmpdir(), 'livekit-compose-');
  const dir = mkdtempSync(prefix);
  try {
    for (const file of files) copyFileSync(new URL(`../${file}`, import.meta.url), join(dir, file));
    // Synthetic environment only; never load the checkout's local configuration.
    writeFileSync(join(dir, '.env'), '');
    const args = files.flatMap((file) => ['-f', file]);
    return JSON.parse(
      execFileSync('docker', ['compose', ...args, 'config', '--format', 'json'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          JWT_SECRET: 'compose-test-jwt-secret-at-least-32-characters',
          API_TOKEN_PEPPER: 'compose-test-pepper-at-least-32-characters',
          LIVEKIT_API_KEY: 'compose-test-key',
          LIVEKIT_API_SECRET: 'compose-test-secret-at-least-32-characters',
          CORS_ORIGIN: 'http://localhost:5173',
          ...overrides,
        },
      }),
    ).services;
  } finally {
    assert.ok(dir.startsWith(prefix));
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Linux LiveKit uses host networking and the server reaches the host gateway', () => {
  const { livekit, server, migrate } = renderCompose(['compose.yaml']);
  assert.equal(livekit.network_mode, 'host');
  assert.equal(livekit.ports, undefined);
  assert.equal(livekit.networks, undefined);
  assert.deepEqual(livekit.command, ['--dev', '--bind', '0.0.0.0']);
  assert.deepEqual(
    parseYaml(livekit.environment.LIVEKIT_KEYS, { mapAsMap: true }),
    new Map([['compose-test-key', 'compose-test-secret-at-least-32-characters']]),
  );
  for (const service of [server, migrate]) {
    assert.equal(service.environment.LIVEKIT_API_KEY, 'compose-test-key');
    assert.equal(service.environment.LIVEKIT_API_SECRET, 'compose-test-secret-at-least-32-characters');
  }
  assert.equal(server.environment.LIVEKIT_URL, 'ws://host.docker.internal:7880');
  assert.deepEqual(server.extra_hosts, ['host.docker.internal=host-gateway']);
});

test('Desktop replaces host networking with bridge and exactly three published ports', () => {
  const { livekit, server } = renderCompose(['compose.yaml', 'compose.docker-desktop.yaml']);
  assert.equal(livekit.network_mode, 'bridge');
  assert.equal(livekit.networks, undefined);
  assert.equal(livekit.environment.NODE_IP, '127.0.0.1');
  assert.deepEqual(
    parseYaml(livekit.environment.LIVEKIT_KEYS, { mapAsMap: true }),
    new Map([['compose-test-key', 'compose-test-secret-at-least-32-characters']]),
  );
  assert.deepEqual(
    livekit.ports.map(({ target, published, protocol }) => [target, published, protocol]),
    [
      [7880, '7880', 'tcp'],
      [7881, '7881', 'tcp'],
      [7882, '7882', 'udp'],
    ],
  );
  assert.equal(server.environment.LIVEKIT_URL, 'ws://host.docker.internal:7880');
});

test('Desktop preserves host IP, signal publication, internal URL and credential overrides', () => {
  const { livekit, server, migrate } = renderCompose(['compose.yaml', 'compose.docker-desktop.yaml'], {
    HOST_IP: '192.0.2.10',
    LIVEKIT_SIGNAL_PORT: '17880',
    LIVEKIT_URL: 'ws://host.docker.internal:17880',
    LIVEKIT_API_KEY: 'override-test-key',
    LIVEKIT_API_SECRET: 'override-test-secret-at-least-32-characters',
  });
  assert.equal(livekit.environment.NODE_IP, '192.0.2.10');
  assert.equal(livekit.ports[0].published, '17880');
  assert.equal(server.environment.LIVEKIT_URL, 'ws://host.docker.internal:17880');
  assert.deepEqual(
    parseYaml(livekit.environment.LIVEKIT_KEYS, { mapAsMap: true }),
    new Map([['override-test-key', 'override-test-secret-at-least-32-characters']]),
  );
  for (const service of [server, migrate]) {
    assert.equal(service.environment.LIVEKIT_API_KEY, 'override-test-key');
    assert.equal(service.environment.LIVEKIT_API_SECRET, 'override-test-secret-at-least-32-characters');
  }
});

for (const key of ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) {
  test(`Compose rejects a missing or empty ${key} with its name and README guidance`, () => {
    for (const files of [['compose.yaml'], ['compose.yaml', 'compose.docker-desktop.yaml']]) {
      for (const value of [undefined, '']) {
        assert.throws(
          () => renderCompose(files, { [key]: value }),
          (error) => {
            assert.ok(error.stderr.toString().includes(key));
            assert.ok(error.stderr.toString().includes('README Quick Start'));
            return true;
          },
        );
      }
    }
  });
}
