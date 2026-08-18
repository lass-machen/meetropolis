#!/usr/bin/env node
// Run Playwright tests only if @playwright/test is available (it is optional
// here, so a checkout without it must still succeed).
//
// The runner is spawned as a child process rather than imported: Playwright
// stopped exposing a programmatic `runCLI` long ago - `@playwright/test/lib/cli`
// is not in the package's `exports` map at all, and `@playwright/test/cli` is
// an executable that parses argv on import. Importing either of them made this
// script exit 1 with "Unexpected error" the moment Playwright was installed,
// which is exactly when the E2E suite is supposed to run.
//
// Arguments are passed through, so `npm run e2e -- --grep "auth layout"` works.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

function main() {
  const require = createRequire(import.meta.url);
  let cli;
  try {
    cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      // Skipping is only correct when nobody asked for a run. With E2E_RUN=true
      // somebody did, and the specs read the same variable to decide whether
      // they execute at all - exiting 0 here would report a green E2E stage
      // that ran nothing. That used to be tolerable while Playwright was an
      // optional extra; it is a declared devDependency now, so a missing runner
      // means a broken install (`npm ci --omit=dev`, a half-written cache) and
      // has to be loud.
      if (process.env.E2E_RUN === 'true') {
        console.error('[E2E] E2E_RUN=true, but @playwright/test is not installed. Refusing to report a green run.');
        console.error('[E2E] Install the dev dependencies (npm ci) or unset E2E_RUN to skip on purpose.');
        process.exit(1);
      }
      console.log('[E2E] @playwright/test not installed, skipping E2E. Set E2E_RUN=true in env when available.');
      process.exit(0);
    }
    console.error('[E2E] Unexpected error:', err);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error) {
    console.error('[E2E] Unexpected error:', result.error);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

main();
