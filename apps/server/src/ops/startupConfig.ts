/**
 * Startup configuration check entry point.
 *
 * Deploy tooling runs this in the new image as `node dist/ops/startupConfig.js`
 * before the running server is replaced. It reports every static finding as
 * one `key: reason` line on stderr and exits 1, or confirms a clean
 * configuration on stdout and exits 0. Values never appear in the output.
 */
import 'dotenv/config';

import { findStartupConfigFindings } from './startupConfigFindings.js';

try {
  const findings = await findStartupConfigFindings(process.env);
  if (findings.length === 0) {
    process.stdout.write('Startup configuration check passed.\n');
  } else {
    for (const finding of findings) {
      process.stderr.write(`${finding.key}: ${finding.reason}\n`);
    }
    process.exit(1);
  }
} catch (error) {
  process.stderr.write(
    `Startup configuration check failed: ${error instanceof Error ? error.name : 'unknown error'}\n`,
  );
  process.exit(1);
}
