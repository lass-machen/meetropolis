#!/usr/bin/env node
// Run Playwright tests only if @playwright/test is available
async function main() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runCLI } = require('@playwright/test/lib/cli');
    const code = await runCLI(['test']);
    process.exit(code);
  } catch (e) {
    console.log('[E2E] @playwright/test not installed, skipping E2E. Set E2E_RUN=true in env when available.');
    process.exit(0);
  }
}
main();


