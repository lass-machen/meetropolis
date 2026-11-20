import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('redacts recipients, subjects, message bodies and links in every console-provider mode', async () => {
  for (const mode of ['development', 'production', 'test']) {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'test/fixtures/consoleDeliveryProbe.ts'],
      { cwd: process.cwd(), env: { ...process.env, NODE_ENV: mode }, timeout: 15_000 },
    );
    const leaked = /private-fixture|example\.test|PRIVATE_|https:\/\//.test(stdout + stderr);
    expect(leaked).toBe(false);
  }
});
