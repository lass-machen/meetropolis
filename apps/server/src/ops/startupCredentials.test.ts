import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prepareCredentialCheckerDir } from '../testUtils/credentialCheckerDir.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, '..', '..');
const ENTRYPOINT = path.resolve(SERVER_DIR, 'entrypoint.sh');
const TEMPLATE_PATH = path.resolve(SERVER_DIR, '..', '..', '.env.example');

let checkerDir: string;

beforeAll(() => {
  checkerDir = prepareCredentialCheckerDir();
});

afterAll(() => {
  fs.rmSync(checkerDir, { recursive: true, force: true });
});

const MARKER_TEXT = 'ready';
const PRODUCTION = 'production';
const DEVELOPMENT = 'development';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function readTemplateValue(key: string): string {
  const text = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match !== null && match[1] === key) {
      return match[2];
    }
  }
  throw new Error(`template entry missing for key: ${key}`);
}

function validEnv(mode: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    NODE_ENV: mode,
    LIVEKIT_API_KEY: 'synthetic-valid-livekit-key',
    LIVEKIT_API_SECRET: 'synthetic-valid-livekit-secret',
    TOOLS_PASSWORD: 'synthetic-valid-tools-password',
    DATABASE_URL: 'postgresql://meetropolis:synthetic-valid-db-password@localhost:5432/meetropolis?schema=public',
  };
}

interface StartResult {
  status: number | null;
  stdout: string;
  stderr: string;
  markerFound: boolean;
  markerText: string | null;
}

function startWithEnv(env: Record<string, string>): StartResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-credentials-'));
  tempDirs.push(dir);
  const marker = path.join(dir, 'started');
  const markerScript = `require("fs").writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(MARKER_TEXT)})`;
  const result = spawnSync('sh', [ENTRYPOINT, 'node', '-e', markerScript], {
    cwd: checkerDir,
    env: { ...env, RUN_MIGRATIONS: 'false', RUN_SEED: 'false' },
    encoding: 'utf8',
    timeout: 30000,
  });
  expect(result.error).toBeUndefined();
  const markerFound = fs.existsSync(marker);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    markerFound,
    markerText: markerFound ? fs.readFileSync(marker, 'utf8') : null,
  };
}

function expectRejected(result: StartResult, key: string): void {
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr.trim().split('\n')).toEqual([key]);
  expect(result.markerFound).toBe(false);
}

function expectStarted(result: StartResult): void {
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.markerFound).toBe(true);
  expect(result.markerText).toBe(MARKER_TEXT);
}

function urlWithPasswordPart(templateUrl: string): { prefix: string; password: string; suffix: string } {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:/?#]+:)([^@/?#]*)(@.*)$/.exec(templateUrl);
  if (match === null) {
    throw new Error('template database url has no password part');
  }
  let password = match[2];
  try {
    password = decodeURIComponent(password);
  } catch {
    throw new Error('template database password is not decodable');
  }
  if (password.length === 0) {
    throw new Error('template database password is empty');
  }
  return { prefix: match[1], password, suffix: match[3] };
}

function fullyEncoded(value: string): string {
  return Array.from(Buffer.from(value, 'utf8'))
    .map((byte) => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`)
    .join('');
}

describe('startup credentials', () => {
  describe('production mode', () => {
    it('production_rejects_empty_LIVEKIT_API_KEY', () => {
      const variants: Array<string | undefined> = [undefined, '', '   '];
      for (const value of variants) {
        const env = validEnv(PRODUCTION);
        if (value === undefined) {
          delete env.LIVEKIT_API_KEY;
        } else {
          env.LIVEKIT_API_KEY = value;
        }
        expectRejected(startWithEnv(env), 'LIVEKIT_API_KEY');
      }
    });

    it('production_rejects_example_LIVEKIT_API_KEY', () => {
      const env = validEnv(PRODUCTION);
      env.LIVEKIT_API_KEY = readTemplateValue('LIVEKIT_API_KEY');
      expectRejected(startWithEnv(env), 'LIVEKIT_API_KEY');
    });

    it('production_accepts_valid_LIVEKIT_API_KEY', () => {
      expectStarted(startWithEnv(validEnv(PRODUCTION)));
    });

    it('development_accepts_example_LIVEKIT_API_KEY', () => {
      const env = validEnv(DEVELOPMENT);
      env.LIVEKIT_API_KEY = readTemplateValue('LIVEKIT_API_KEY');
      expectStarted(startWithEnv(env));
    });

    it('production_rejects_empty_LIVEKIT_API_SECRET', () => {
      const variants: Array<string | undefined> = [undefined, '', '   '];
      for (const value of variants) {
        const env = validEnv(PRODUCTION);
        if (value === undefined) {
          delete env.LIVEKIT_API_SECRET;
        } else {
          env.LIVEKIT_API_SECRET = value;
        }
        expectRejected(startWithEnv(env), 'LIVEKIT_API_SECRET');
      }
    });

    it('production_rejects_example_LIVEKIT_API_SECRET', () => {
      const env = validEnv(PRODUCTION);
      env.LIVEKIT_API_SECRET = readTemplateValue('LIVEKIT_API_SECRET');
      expectRejected(startWithEnv(env), 'LIVEKIT_API_SECRET');
    });

    it('production_accepts_valid_LIVEKIT_API_SECRET', () => {
      expectStarted(startWithEnv(validEnv(PRODUCTION)));
    });

    it('development_accepts_example_LIVEKIT_API_SECRET', () => {
      const env = validEnv(DEVELOPMENT);
      env.LIVEKIT_API_SECRET = readTemplateValue('LIVEKIT_API_SECRET');
      expectStarted(startWithEnv(env));
    });

    it('production_rejects_empty_TOOLS_PASSWORD', () => {
      for (const value of ['   ', '\t']) {
        const env = validEnv(PRODUCTION);
        env.TOOLS_PASSWORD = value;
        expectRejected(startWithEnv(env), 'TOOLS_PASSWORD');
      }
    });

    it('production_rejects_example_TOOLS_PASSWORD', () => {
      const env = validEnv(PRODUCTION);
      env.TOOLS_PASSWORD = readTemplateValue('TOOLS_PASSWORD');
      expectRejected(startWithEnv(env), 'TOOLS_PASSWORD');
    });

    it('production_accepts_valid_TOOLS_PASSWORD', () => {
      expectStarted(startWithEnv(validEnv(PRODUCTION)));
    });

    it('development_accepts_example_TOOLS_PASSWORD', () => {
      const env = validEnv(DEVELOPMENT);
      env.TOOLS_PASSWORD = readTemplateValue('TOOLS_PASSWORD');
      expectStarted(startWithEnv(env));
    });

    it('production_rejects_empty_DATABASE_URL', () => {
      const variants: Array<string | undefined> = [undefined, '', '   '];
      for (const value of variants) {
        const env = validEnv(PRODUCTION);
        if (value === undefined) {
          delete env.DATABASE_URL;
        } else {
          env.DATABASE_URL = value;
        }
        expectRejected(startWithEnv(env), 'DATABASE_URL');
      }
      const withoutPassword = [
        'postgresql://meetropolis:@localhost:5432/meetropolis?schema=public',
        'postgresql://meetropolis@localhost:5432/meetropolis?schema=public',
      ];
      for (const value of withoutPassword) {
        const env = validEnv(PRODUCTION);
        env.DATABASE_URL = value;
        expectRejected(startWithEnv(env), 'DATABASE_URL');
      }
    });

    it('production_rejects_example_DATABASE_URL', () => {
      const templateUrl = readTemplateValue('DATABASE_URL');
      const env = validEnv(PRODUCTION);
      env.DATABASE_URL = templateUrl;
      expectRejected(startWithEnv(env), 'DATABASE_URL');

      const parts = urlWithPasswordPart(templateUrl);
      const encodedEnv = validEnv(PRODUCTION);
      encodedEnv.DATABASE_URL = `${parts.prefix}${fullyEncoded(parts.password)}${parts.suffix}`;
      expectRejected(startWithEnv(encodedEnv), 'DATABASE_URL');

      const base = validEnv(PRODUCTION).DATABASE_URL;
      const queryEnv = validEnv(PRODUCTION);
      queryEnv.DATABASE_URL = `${base}&password=${fullyEncoded(parts.password)}`;
      expectRejected(startWithEnv(queryEnv), 'DATABASE_URL');
    });

    it('production_accepts_valid_DATABASE_URL', () => {
      const env = validEnv(PRODUCTION);
      expect('POSTGRES_PASSWORD' in env).toBe(false);
      expectStarted(startWithEnv(env));
    });

    it('development_accepts_example_DATABASE_URL', () => {
      const env = validEnv(DEVELOPMENT);
      env.DATABASE_URL = readTemplateValue('DATABASE_URL');
      expectStarted(startWithEnv(env));
    });

    it('production_rejects_empty_POSTGRES_PASSWORD', () => {
      for (const value of ['', '   ']) {
        const env = validEnv(PRODUCTION);
        env.POSTGRES_PASSWORD = value;
        expectRejected(startWithEnv(env), 'POSTGRES_PASSWORD');
      }
    });

    it('production_rejects_example_POSTGRES_PASSWORD', () => {
      const env = validEnv(PRODUCTION);
      env.POSTGRES_PASSWORD = readTemplateValue('POSTGRES_PASSWORD');
      expectRejected(startWithEnv(env), 'POSTGRES_PASSWORD');
    });

    it('production_accepts_valid_POSTGRES_PASSWORD', () => {
      const env = validEnv(PRODUCTION);
      env.POSTGRES_PASSWORD = 'synthetic-valid-postgres-password';
      expectStarted(startWithEnv(env));
    });

    it('development_accepts_example_POSTGRES_PASSWORD', () => {
      const env = validEnv(DEVELOPMENT);
      env.POSTGRES_PASSWORD = readTemplateValue('POSTGRES_PASSWORD');
      expectStarted(startWithEnv(env));
    });

    it('production_accepts_unset_TOOLS_PASSWORD', () => {
      const missing = validEnv(PRODUCTION);
      delete missing.TOOLS_PASSWORD;
      expectStarted(startWithEnv(missing));

      const empty = validEnv(PRODUCTION);
      empty.TOOLS_PASSWORD = '';
      expectStarted(startWithEnv(empty));
    });
  });
});
