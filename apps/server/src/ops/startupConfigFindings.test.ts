/**
 * Startup configuration findings: one case per check, key names only.
 *
 * The valid environment mirrors the credential entry test so every check
 * passes on it. Each failure case asserts the exact key and the fixed
 * reason; value freedom is asserted wherever a marker value could leak.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findStartupConfigFindings, resolvePublicPort, type StartupConfigFinding } from './startupConfigFindings.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-config-'));
  tempDirs.push(dir);
  return dir;
}

function validEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    LIVEKIT_API_KEY: 'synthetic-valid-livekit-key',
    LIVEKIT_API_SECRET: 'synthetic-valid-livekit-secret',
    TOOLS_PASSWORD: 'synthetic-valid-tools-password',
    DATABASE_URL: 'postgresql://meetropolis:synthetic-valid-db-password@localhost:5432/meetropolis?schema=public',
    CORS_ORIGIN: 'https://app.example.com',
  };
}

function findingKeys(findings: StartupConfigFinding[]): string[] {
  return findings.map((finding) => finding.key);
}

describe('findStartupConfigFindings', () => {
  it('reports nothing for a valid environment', async () => {
    await expect(findStartupConfigFindings(validEnv())).resolves.toEqual([]);
  });

  it('reports an unusable database url without the value', async () => {
    const findings = await findStartupConfigFindings({ ...validEnv(), DATABASE_URL: 'not-a-database-url' });
    expect(findings).toEqual([{ key: 'DATABASE_URL', reason: 'unusable credential' }]);
  });

  it('reports a missing origin list without the value', async () => {
    const findings = await findStartupConfigFindings({ ...validEnv(), CORS_ORIGIN: 'not-an-origin' });
    expect(findings).toEqual([{ key: 'CORS_ORIGIN', reason: 'missing or invalid origin list' }]);
  });

  it('reports a pending restore marker for the journal directory', async () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'restore-pending.json'), '{"restored":false}');
    const findings = await findStartupConfigFindings({
      ...validEnv(),
      DELETION_JOURNAL_DIR: dir,
      BACKUP_RETENTION_DAYS: '7',
    });
    expect(findings).toEqual([{ key: 'DELETION_JOURNAL_DIR', reason: 'restore pending' }]);
  });

  it('reports an invalid retention setting without the value', async () => {
    const findings = await findStartupConfigFindings({
      ...validEnv(),
      DELETION_JOURNAL_DIR: makeTempDir(),
      BACKUP_RETENTION_DAYS: 'Marker-Value-91c',
    });
    expect(findings).toEqual([{ key: 'BACKUP_RETENTION_DAYS', reason: 'invalid deletion journal setting' }]);
    expect(findings[0]?.reason ?? '').not.toContain('Marker-Value-91c');
  });

  it('reports an invalid tools origin list only when the tools route is on', async () => {
    const enabled = await findStartupConfigFindings({
      ...validEnv(),
      TOOLS_USER: 'tools-user',
      TOOLS_API_ORIGINS: 'not-an-origin',
    });
    expect(enabled).toEqual([{ key: 'TOOLS_API_ORIGINS', reason: 'invalid origin list' }]);

    const disabled = await findStartupConfigFindings({
      ...validEnv(),
      TOOLS_API_ORIGINS: 'not-an-origin',
    });
    expect(disabled).toEqual([]);
  });

  it('reports a metrics port equal to the public port', async () => {
    const findings = await findStartupConfigFindings({
      ...validEnv(),
      PORT: '3000',
      METRICS_PORT: '3000',
    });
    expect(findings).toEqual([{ key: 'METRICS_PORT', reason: 'invalid port or equal to PORT' }]);
  });

  it('reports each invalid upgrade rate limit without the value', async () => {
    const max = await findStartupConfigFindings({ ...validEnv(), WS_UPGRADE_RATE_LIMIT_MAX: 'huge' });
    expect(max).toEqual([{ key: 'WS_UPGRADE_RATE_LIMIT_MAX', reason: 'invalid rate limit setting' }]);

    const windowMs = await findStartupConfigFindings({
      ...validEnv(),
      WS_UPGRADE_RATE_LIMIT_WINDOW_MS: 'huge',
    });
    expect(windowMs).toEqual([{ key: 'WS_UPGRADE_RATE_LIMIT_WINDOW_MS', reason: 'invalid rate limit setting' }]);
  });

  it('reports an invalid default tenant slug without the value', async () => {
    const findings = await findStartupConfigFindings({ ...validEnv(), DEFAULT_TENANT_SLUG: 'Not Valid' });
    expect(findings).toEqual([{ key: 'DEFAULT_TENANT_SLUG', reason: 'invalid tenant slug' }]);
    expect(findings[0]?.reason ?? '').not.toContain('Not Valid');
  });

  it('collects several findings at once in check order', async () => {
    const findings = await findStartupConfigFindings({
      ...validEnv(),
      CORS_ORIGIN: 'not-an-origin',
      DEFAULT_TENANT_SLUG: 'Not Valid',
    });
    expect(findingKeys(findings)).toEqual(['CORS_ORIGIN', 'DEFAULT_TENANT_SLUG']);
  });
});

describe('resolvePublicPort', () => {
  it('uses 2567 without PORT', () => {
    expect(resolvePublicPort({})).toBe(2567);
  });

  it('uses PORT when set', () => {
    expect(resolvePublicPort({ PORT: '3000' })).toBe(3000);
  });
});
