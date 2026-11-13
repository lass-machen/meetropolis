// Validates the source import policy of the parsed policy object.
//
// The reader checks the sourceImports section: protected package roots
// and families, protected and forbidden scopes, the allowed dynamic
// loader imports and the pinned integrity records. It returns a new
// normalized structure with stably sorted strings and record arrays and
// never mutates the input. The reader opens no file, uses no network and
// neither writes nor prints anything. Any violation fails with the
// constant data error below.

const SCHEMA_VERSION = 1;
const DATA_INVALID_CODE = 'COMPLIANCE_DATA_INVALID';
const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';
const DATA_INVALID_EXIT_CODE = 2;

const SOURCE_IMPORT_FIELDS = [
  'protectedPackageRoots',
  'protectedPackageFamilies',
  'protectedScopes',
  'forbiddenWebScopes',
  'allowedDynamicImports',
  'pinnedFiles',
  'pinnedDynamicImports',
];
const ALLOW_ENTRY_FIELDS = ['path', 'specifier'];
const PIN_FILE_FIELDS = ['path', 'sha256', 'reason'];
const PIN_DYNAMIC_FIELDS = ['path', 'sha256', 'kind', 'argumentKind', 'line', 'targetPath', 'reason'];

// The only loader locations that may carry an allow entry. Withdrawing a
// loader only removes its allow, it never grants one.
const KNOWN_LOADER_PATHS = [
  'apps/server/src/adminLoader.ts',
  'apps/server/src/billingLoader.ts',
  'apps/server/src/emailLoader.ts',
  'apps/server/src/telemetryLoader.ts',
  'apps/server/src/tenancyLoader.ts',
  'apps/server/src/transcriptionLoader.ts',
  'apps/web/src/lib/brandLoader.ts',
  'apps/web/src/lib/desktopLoader.ts',
  'apps/web/src/lib/enterpriseWebLoader.ts',
  'apps/web/src/lib/telemetryLoader.ts',
];
const REQUIRED_FAMILIES = [
  '@meetropolis/brand',
  '@meetropolis/desktop',
  '@meetropolis/enterprise',
  '@meetropolis/telemetry',
];
const SIGNALYR_SCOPE = '@signalyr';
const TAURI_SCOPE = '@tauri-apps';
const PLUGIN_PIN_PATH = 'apps/web/optional-submodules.ts';
const COLLISION_PIN_PATH = 'tools/asset-lab/tests/collision.test.ts';
const COLLISION_TARGET_PATH = 'apps/server/src/api/utils/collisionHelpers.ts';
const ZERO_DIGEST = '0'.repeat(64);

function fail() {
  const error = new Error(DATA_INVALID_MESSAGE);
  error.code = DATA_INVALID_CODE;
  error.exitCode = DATA_INVALID_EXIT_CODE;
  throw error;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Dense array: every index from 0 to length - 1 is present, so holes
// can never smuggle an undefined entry past the element check.
function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) return false;
  }
  return true;
}

function hasExactKeys(value, fields) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

// Strict lowercase scoped root '@scope/name' without subpath, version,
// URL, query, fragment, wildcard, whitespace or control character.
function isPackageRoot(value) {
  return typeof value === 'string' && /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(value);
}

// Strict lowercase scope '@scope' without slash.
function isScopeName(value) {
  return typeof value === 'string' && /^@[a-z0-9][a-z0-9._-]*$/.test(value);
}

// Canonical repository relative path: no backslash, no drive prefix, no
// leading slash, no empty, dot or dot dot segment, no whitespace and no
// control character.
function isCanonicalRepoPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (/[\s\x00-\x1f\x7f]/.test(value)) return false;
  if (value.includes('\\')) return false;
  if (value.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  for (const segment of value.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') return false;
  }
  return true;
}

function isReason(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && value !== ZERO_DIGEST;
}

function uniqueStrings(values, isValid) {
  if (!isDenseArray(values)) return null;
  const seen = new Set();
  for (const value of values) {
    if (!isValid(value) || seen.has(value)) return null;
    seen.add(value);
  }
  return [...values].sort(compareStrings);
}

// Family cover without arbitrary prefix matching: the specifier is the
// family root itself or a root-plus-hyphen member of the family.
function isFamilyCovered(specifier, families) {
  return families.some((family) => specifier === family || specifier.startsWith(`${family}-`));
}

function isScopeCovered(specifier, scopes) {
  return scopes.some((scope) => specifier === scope || specifier.startsWith(`${scope}/`));
}

function readAllowEntry(entry, context) {
  if (!hasExactKeys(entry, ALLOW_ENTRY_FIELDS)) fail();
  if (!isCanonicalRepoPath(entry.path) || !KNOWN_LOADER_PATHS.includes(entry.path)) fail();
  if (context.seenPaths.has(entry.path)) fail();
  context.seenPaths.add(entry.path);
  if (!isPackageRoot(entry.specifier)) fail();
  const covered =
    context.roots.includes(entry.specifier) ||
    isFamilyCovered(entry.specifier, context.families) ||
    isScopeCovered(entry.specifier, context.scopes);
  if (!covered) fail();
  // The relay scope never backs an allow target.
  if (isScopeCovered(entry.specifier, [SIGNALYR_SCOPE])) fail();
  // A forbidden web scope never backs a web loader target.
  if (entry.path.startsWith('apps/web/') && isScopeCovered(entry.specifier, context.webScopes)) fail();
  return { path: entry.path, specifier: entry.specifier };
}

function readPinFile(entry, context) {
  if (!hasExactKeys(entry, PIN_FILE_FIELDS)) fail();
  if (!isCanonicalRepoPath(entry.path)) fail();
  if (!isSha256(entry.sha256)) fail();
  if (!isReason(entry.reason)) fail();
  if (context.seenPaths.has(entry.path)) fail();
  context.seenPaths.add(entry.path);
  return { path: entry.path, sha256: entry.sha256, reason: entry.reason };
}

function readPinDynamic(entry, context) {
  if (!hasExactKeys(entry, PIN_DYNAMIC_FIELDS)) fail();
  if (entry.path !== COLLISION_PIN_PATH) fail();
  if (!isSha256(entry.sha256)) fail();
  if (entry.kind !== 'dynamic-import') fail();
  if (entry.argumentKind !== 'identifier') fail();
  if (!Number.isSafeInteger(entry.line) || entry.line <= 0) fail();
  if (entry.targetPath !== COLLISION_TARGET_PATH) fail();
  if (!isReason(entry.reason)) fail();
  if (context.seenPaths.has(entry.path)) fail();
  context.seenPaths.add(entry.path);
  return {
    path: entry.path,
    sha256: entry.sha256,
    kind: entry.kind,
    argumentKind: entry.argumentKind,
    line: entry.line,
    targetPath: entry.targetPath,
    reason: entry.reason,
  };
}

// Reads the source import policy of a parsed policy object and returns
// a new normalized sourceImports structure with the same seven fields.
// Throws the constant data error on any violation.
export function readSourceImportPolicy(policy) {
  if (!isPlainObject(policy)) fail();
  if (policy.schemaVersion !== SCHEMA_VERSION) fail();
  if (!hasExactKeys(policy.sourceImports, SOURCE_IMPORT_FIELDS)) fail();
  const source = policy.sourceImports;

  const roots = uniqueStrings(source.protectedPackageRoots, isPackageRoot);
  const families = uniqueStrings(source.protectedPackageFamilies, isPackageRoot);
  const scopes = uniqueStrings(source.protectedScopes, isScopeName);
  const webScopes = uniqueStrings(source.forbiddenWebScopes, isScopeName);
  if (roots === null || roots.length === 0) fail();
  if (families === null || families.length === 0) fail();
  if (scopes === null || scopes.length === 0) fail();
  if (webScopes === null || webScopes.length === 0) fail();
  for (const family of REQUIRED_FAMILIES) {
    if (!families.includes(family)) fail();
  }
  if (!scopes.includes(SIGNALYR_SCOPE)) fail();
  if (!webScopes.includes(TAURI_SCOPE)) fail();

  const context = { roots, families, scopes, webScopes, seenPaths: new Set() };
  if (!isDenseArray(source.allowedDynamicImports)) fail();
  const allowedDynamicImports = source.allowedDynamicImports
    .map((entry) => readAllowEntry(entry, context))
    .sort((left, right) => compareStrings(left.path, right.path));

  const pinContext = { seenPaths: new Set() };
  if (!isDenseArray(source.pinnedFiles)) fail();
  const pinnedFiles = source.pinnedFiles
    .map((entry) => readPinFile(entry, pinContext))
    .sort((left, right) => compareStrings(left.path, right.path));
  if (!pinnedFiles.some((entry) => entry.path === PLUGIN_PIN_PATH)) fail();

  if (!isDenseArray(source.pinnedDynamicImports)) fail();
  const pinnedDynamicImports = source.pinnedDynamicImports
    .map((entry) => readPinDynamic(entry, pinContext))
    .sort((left, right) => compareStrings(left.path, right.path));

  return {
    protectedPackageRoots: roots,
    protectedPackageFamilies: families,
    protectedScopes: scopes,
    forbiddenWebScopes: webScopes,
    allowedDynamicImports,
    pinnedFiles,
    pinnedDynamicImports,
  };
}
