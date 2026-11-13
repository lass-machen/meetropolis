// Loader for the source parser used by the compliance gate.
//
// The parser is a devDependency of the gate checkout. When the checkout has
// no installation, every loading problem collapses into one constant error:
// the gate output stays stable and never leaks local paths or raw resolver
// details. The module never writes output and never ends the process.
//
// The loader only accepts the parser of its own checkout: the entry point
// and its package metadata have to live physically inside the node_modules
// directory of the checkout that owns this file. Borrowed parent installs,
// NODE_PATH entries and external symlinks never replace a missing own
// installation.

import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PARSER_UNAVAILABLE_CODE = 'COMPLIANCE_PARSER_UNAVAILABLE';
const PARSER_UNAVAILABLE_EXIT_CODE = 2;
const PARSER_UNAVAILABLE_MESSAGE =
  'The source parser is not available. Run "npm ci" in the gate checkout and repeat the check.';

const EXPECTED_PARSER_NAME = '@babel/parser';

// Checkout root is derived from this file, two levels above
// scripts/compliance. The require function is anchored at the package
// manifest of that root, never at the importing file.
const GATE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE_REQUIRE = createRequire(pathToFileURL(path.join(GATE_ROOT, 'package.json')).href);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failParser() {
  const error = new Error(PARSER_UNAVAILABLE_MESSAGE);
  error.code = PARSER_UNAVAILABLE_CODE;
  error.exitCode = PARSER_UNAVAILABLE_EXIT_CODE;
  throw error;
}

function safeRealpath(candidate) {
  try {
    return realpathSync(candidate);
  } catch {
    return null;
  }
}

// Expected parser version from the manifest and lockfile of the own
// checkout: all three pins have to be non-empty strings with the same
// direct exact version. Returns null on any missing or contradictory
// source metadata.
function readExpectedVersion(checkoutRoot) {
  let manifest;
  let lock;
  try {
    manifest = JSON.parse(readFileSync(path.join(checkoutRoot, 'package.json'), 'utf8'));
    lock = JSON.parse(readFileSync(path.join(checkoutRoot, 'package-lock.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!isPlainObject(manifest) || !isPlainObject(lock)) return null;
  const fromManifest = isPlainObject(manifest.devDependencies)
    ? manifest.devDependencies[EXPECTED_PARSER_NAME]
    : undefined;
  const packages = isPlainObject(lock.packages) ? lock.packages : undefined;
  if (packages === undefined) return null;
  const rootEntry = isPlainObject(packages['']) ? packages[''] : undefined;
  const nodeEntry = isPlainObject(packages[`node_modules/${EXPECTED_PARSER_NAME}`])
    ? packages[`node_modules/${EXPECTED_PARSER_NAME}`]
    : undefined;
  const fromLockRoot =
    rootEntry !== undefined && isPlainObject(rootEntry.devDependencies)
      ? rootEntry.devDependencies[EXPECTED_PARSER_NAME]
      : undefined;
  const fromLockNode = nodeEntry !== undefined ? nodeEntry.version : undefined;
  for (const pin of [fromManifest, fromLockRoot, fromLockNode]) {
    if (typeof pin !== 'string' || pin.length === 0) return null;
  }
  if (fromLockRoot !== fromManifest || fromLockNode !== fromManifest) return null;
  return fromManifest;
}

// Returns the original parser module with its parse function.
// Throws a constant COMPLIANCE_PARSER_UNAVAILABLE error when the own
// checkout has no usable parser installation.
export function loadSourceParser() {
  const checkoutRoot = safeRealpath(GATE_ROOT);
  if (checkoutRoot === null) failParser();
  let entryPath;
  let metaPath;
  try {
    entryPath = GATE_REQUIRE.resolve('@babel/parser');
    metaPath = GATE_REQUIRE.resolve('@babel/parser/package.json');
  } catch {
    failParser();
  }
  // Both the entry point and its metadata have to resolve inside the
  // node_modules directory of the real checkout root. The comparison is
  // segment based so node_modules-other never matches, and the base is
  // the real checkout root itself so a symlinked node_modules directory
  // cannot move the comparison onto foreign storage.
  const modulesPrefix = `${checkoutRoot}${path.sep}node_modules${path.sep}`;
  const realEntry = safeRealpath(entryPath);
  const realMeta = safeRealpath(metaPath);
  if (realEntry === null || realMeta === null) failParser();
  if (!realEntry.startsWith(modulesPrefix) || !realMeta.startsWith(modulesPrefix)) failParser();
  let meta;
  try {
    meta = JSON.parse(readFileSync(realMeta, 'utf8'));
  } catch {
    failParser();
  }
  const expectedVersion = readExpectedVersion(checkoutRoot);
  if (expectedVersion === null) failParser();
  if (!isPlainObject(meta) || meta.name !== EXPECTED_PARSER_NAME || meta.version !== expectedVersion) {
    failParser();
  }
  // Only the validated original entry is ever loaded, with the same
  // literal specifier as before and no computed require target.
  let parser;
  try {
    parser = GATE_REQUIRE('@babel/parser');
  } catch {
    failParser();
  }
  if (typeof parser?.parse !== 'function') {
    failParser();
  }
  return parser;
}
