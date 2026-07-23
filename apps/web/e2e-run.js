#!/usr/bin/env node
// Run Playwright tests only if @playwright/test is available.
// We use dynamic import instead of require because apps/web runs as an ESM
// workspace (type: module). The try/catch handles MODULE_NOT_FOUND when
// Playwright is not installed (optional in CI / locally).
async function main() {
  try {
    const mod = await import('@playwright/test/lib/cli');
    const runCLI = mod.runCLI ?? mod.default?.runCLI;
    if (typeof runCLI !== 'function') {
      console.log('[E2E] @playwright/test CLI not exposed as runCLI, skipping.');
      process.exit(0);
    }
    const code = await runCLI(['test']);
    process.exit(code);
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      console.log('[E2E] @playwright/test not installed, skipping E2E. Set E2E_RUN=true in env when available.');
      process.exit(0);
    }
    console.error('[E2E] Unexpected error:', err);
    process.exit(1);
  }
}
main();
