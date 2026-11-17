/**
 * Startup configuration entry point: exit codes and value-free output.
 *
 * Each case sets the process environment, imports the entry fresh, and
 * restores the environment afterwards. Exit, stdout and stderr are stubbed
 * so the entry never ends the test worker.
 */
import client from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Load the dependencies of the entry once while this file is collected, so the
// first case does not pay the cold module load inside its own time budget. Every
// case still imports the entry itself fresh after vi.resetModules().
import './startupConfigFindings.js';

const MANAGED_KEYS = [
  'NODE_ENV',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'TOOLS_USER',
  'TOOLS_PASSWORD',
  'DATABASE_URL',
  'PORT',
  'CORS_ORIGIN',
  'DELETION_JOURNAL_DIR',
  'BACKUP_RETENTION_DAYS',
  'TOOLS_API_ORIGINS',
  'METRICS_PORT',
  'WS_UPGRADE_RATE_LIMIT_MAX',
  'WS_UPGRADE_RATE_LIMIT_WINDOW_MS',
  'DEFAULT_TENANT_SLUG',
];

const savedEnv: Record<string, string | undefined> = {};
let stdoutText = '';
let stderrText = '';

function useEnv(values: Record<string, string>): void {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

function validValues(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    LIVEKIT_API_KEY: 'synthetic-valid-livekit-key',
    LIVEKIT_API_SECRET: 'synthetic-valid-livekit-secret',
    TOOLS_PASSWORD: 'synthetic-valid-tools-password',
    DATABASE_URL: 'postgresql://meetropolis:synthetic-valid-db-password@localhost:5432/meetropolis?schema=public',
    CORS_ORIGIN: 'https://app.example.com',
  };
}

async function runEntry(): Promise<{ exitCode: number | undefined; stdout: string; stderr: string }> {
  stdoutText = '';
  stderrText = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutText += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrText += String(chunk);
    return true;
  });
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never);
  process.exitCode = undefined;
  vi.resetModules();
  // The entry re-registers metrics on the shared global registry on every
  // fresh import; clear it first so repeated imports stay possible.
  client.register.clear();
  await import('./startupConfig.js');
  const code = exit.mock.calls[0]?.[0];
  return { exitCode: typeof code === 'number' ? code : undefined, stdout: stdoutText, stderr: stderrText };
}

beforeEach(() => {
  for (const key of MANAGED_KEYS) {
    savedEnv[key] = process.env[key];
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of MANAGED_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('startup configuration entry point', () => {
  it('confirms a clean configuration with exit code 0', async () => {
    useEnv(validValues());
    const result = await runEntry();
    expect(result.exitCode).toBeUndefined();
    expect(process.exitCode ?? 0).toBe(0);
    expect(result.stdout).toBe('Startup configuration check passed.\n');
    expect(result.stderr).toBe('');
  });

  it('reports a finding with exit code 1', async () => {
    useEnv({ ...validValues(), CORS_ORIGIN: 'not-an-origin' });
    const result = await runEntry();
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('CORS_ORIGIN: missing or invalid origin list\n');
  });

  it('never prints a configured value, only key names', async () => {
    useEnv({
      ...validValues(),
      TOOLS_USER: 'tools-user',
      DATABASE_URL: 'Marker-Value-91c',
      CORS_ORIGIN: 'not-an-origin-Marker-Value-91c',
      DELETION_JOURNAL_DIR: '/tmp/definitely-missing-Marker-Value-91c',
      BACKUP_RETENTION_DAYS: '7',
      TOOLS_API_ORIGINS: 'https://Marker-Value-91c.invalid',
      METRICS_PORT: 'Marker-Value-91c',
      WS_UPGRADE_RATE_LIMIT_MAX: 'Marker-Value-91c',
      WS_UPGRADE_RATE_LIMIT_WINDOW_MS: 'Marker-Value-91c',
      DEFAULT_TENANT_SLUG: 'Marker-Value-91c',
    });
    const result = await runEntry();
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('Marker-Value-91c');
    expect(result.stderr.split('\n').filter((line) => line.length > 0)).toEqual([
      'DATABASE_URL: unusable credential',
      'CORS_ORIGIN: missing or invalid origin list',
      'DELETION_JOURNAL_DIR: invalid deletion journal setting',
      'TOOLS_API_ORIGINS: invalid origin list',
      'METRICS_PORT: invalid port or equal to PORT',
      'WS_UPGRADE_RATE_LIMIT_MAX: invalid rate limit setting',
      'WS_UPGRADE_RATE_LIMIT_WINDOW_MS: invalid rate limit setting',
      'DEFAULT_TENANT_SLUG: invalid tenant slug',
    ]);
  });

  it('names only the error kind when the check itself fails', async () => {
    useEnv(validValues());
    stdoutText = '';
    stderrText = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(() => {
      throw new Error('boom');
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrText += String(chunk);
      return true;
    });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never);
    vi.resetModules();
    client.register.clear();
    await import('./startupConfig.js');
    expect(exit.mock.calls[0]?.[0]).toBe(1);
    expect(stderrText).toContain('Startup configuration check failed: Error');
    expect(stderrText).not.toContain('boom');
  });
});
