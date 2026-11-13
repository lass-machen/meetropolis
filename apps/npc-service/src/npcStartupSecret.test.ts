import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const configPath = join(moduleDir, 'config.ts');
const secretKey = 'NPC_SERVICE_SECRET';

function readKnownDefault(): string {
  const source = readFileSync(configPath, 'utf8');
  const direct = source.match(/KNOWN_DEFAULT_SECRET\s*=\s*'([^']+)'/);
  if (direct) return direct[1];
  const fallback = source.match(/NPC_SERVICE_SECRET[^\n]*\|\|\s*'([^']+)'/);
  if (fallback) return fallback[1];
  throw new Error('known default placeholder not found in config source');
}

interface StartupProbe {
  code: number | null;
  output: string;
}

function probeStartup(secret: string | undefined, nodeEnv: string): Promise<StartupProbe> {
  const loader =
    `import(${JSON.stringify(pathToFileURL(configPath).href)}).then(` +
    `() => console.log('config loaded'),` +
    `(error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });`;
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: nodeEnv };
  if (secret === undefined) {
    delete env[secretKey];
  } else {
    env[secretKey] = secret;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', loader], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', reject);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('config probe timed out'));
    }, 20000);
    if (typeof timer.unref === 'function') timer.unref();
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe('npc service startup secret', () => {
  const knownDefault = readKnownDefault();
  const cases: Array<{ name: string; secret: string | undefined }> = [
    { name: 'rejects a missing secret', secret: undefined },
    { name: 'rejects an empty secret', secret: '' },
    { name: 'rejects a whitespace secret', secret: ' \t  ' },
    { name: 'rejects the known default secret', secret: knownDefault },
    { name: 'rejects a short secret', secret: 'x'.repeat(31) },
  ];
  for (const mode of ['development', 'production']) {
    describe(`in ${mode} mode`, () => {
      for (const entry of cases) {
        it(entry.name, async () => {
          const probe = await probeStartup(entry.secret, mode);
          expect(probe.code).not.toBe(0);
          expect(probe.output).toContain(secretKey);
          if (entry.secret) {
            expect(probe.output).not.toContain(entry.secret);
          }
        }, 30000);
      }
    });
  }
});
