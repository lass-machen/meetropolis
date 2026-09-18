import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('server entrypoint', () => {
  it('propagates a seed failure and never starts the server command', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetropolis-entrypoint-'));
    tempDirs.push(tempDir);
    const fakeNpx = path.join(tempDir, 'npx');
    const marker = path.join(tempDir, 'server-started');
    fs.writeFileSync(fakeNpx, '#!/bin/sh\n[ "$2" = "db" ] && exit 23\nexit 0\n');
    fs.chmodSync(fakeNpx, 0o755);
    const entrypoint = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../entrypoint.sh');

    const result = spawnSync('sh', [entrypoint, 'sh', '-c', `touch "${marker}"`], {
      env: {
        ...process.env,
        PATH: `${tempDir}:${process.env.PATH ?? ''}`,
        RUN_MIGRATIONS: 'true',
        RUN_SEED: 'true',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(23);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
