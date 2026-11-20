/**
 * Startup adapter: enforces the production credential policy before the
 * server builds its application graph.
 *
 * Imported for its side effect as the first import in index.ts, right after
 * the environment file load and before the application imports (which build
 * database clients at import time). Also executed directly by entrypoint.sh
 * and the migration command, so every production start path fails closed
 * before any migration, seed, or listen work. Prints one offending key name
 * per line and exits with status 1. Silent on success.
 */

import { findInvalidCredentialKeys } from './credentialPolicy.js';

const invalidKeys = findInvalidCredentialKeys(process.env);

if (invalidKeys.length > 0) {
  for (const key of invalidKeys) {
    process.stderr.write(`${key}\n`);
  }
  process.exit(1);
}
