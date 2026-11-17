// Checks the dynamic import boundaries of repository sources.
//
// The check receives repository file bytes through a map and validates the
// module references of every code file against the sourceImports section of
// the versioned policy: only exact path and specifier pairs listed in the
// policy may import a protected target, unknown unprotected targets stay
// untouched, and non-literal imports pass only through a fully matching
// dynamic pin. The check opens no file, uses no network, executes no source
// and neither writes nor prints anything. Any invalid input fails with the
// constant data error below; syntax findings of the parser pass through.

import { createHash } from 'node:crypto';
import { collectSourceImports } from './source-imports.mjs';
import { readSourceImportPolicy } from './source-policy.mjs';

const DATA_INVALID_CODE = 'COMPLIANCE_DATA_INVALID';
const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';
const DATA_INVALID_EXIT_CODE = 2;

const POLICY_PATH = 'compliance/policy.json';
const CODE_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts']);
const IMPORT_FORBIDDEN = 'SOURCE_IMPORT_FORBIDDEN';
const WEB_SCOPE_FORBIDDEN = 'SOURCE_WEB_SCOPE_FORBIDDEN';
const NON_LITERAL_IMPORT = 'SOURCE_NON_LITERAL_IMPORT';
const PIN_MISSING = 'SOURCE_PIN_MISSING';
const PIN_MISMATCH = 'SOURCE_PIN_MISMATCH';
const PIN_TARGET_MISSING = 'SOURCE_PIN_TARGET_MISSING';
const DYNAMIC_PIN_STALE = 'SOURCE_DYNAMIC_PIN_STALE';
const MANIFEST_PRIVATE = 'SOURCE_MANIFEST_PRIVATE';
const LOCK_PRIVATE = 'SOURCE_LOCK_PRIVATE';

function fail() {
  const error = new Error(DATA_INVALID_MESSAGE);
  error.code = DATA_INVALID_CODE;
  error.exitCode = DATA_INVALID_EXIT_CODE;
  throw error;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail();
  }
}

// Canonical map path: like a repository path, but a plain space inside an
// otherwise valid path stays allowed here.
function isMapPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  if (value.includes('\\')) return false;
  if (value.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') return false;
  }
  return true;
}

function extensionOf(filePath) {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1);
}

// Detection view only: lowercase with query and fragment stripped. The
// allow check below always uses the original decoded specifier.
function normalizeSpecifier(specifier) {
  return specifier.split(/[?#]/, 1)[0].toLowerCase();
}

function isRootCovered(normalized, roots) {
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function isFamilyCovered(normalized, families) {
  return families.some(
    (family) => normalized === family || normalized.startsWith(`${family}-`) || normalized.startsWith(`${family}/`),
  );
}

function isScopeCovered(normalized, scopes) {
  return scopes.some((scope) => normalized === scope || normalized.startsWith(`${scope}/`));
}

function isProtected(normalized, policy) {
  return (
    isRootCovered(normalized, policy.protectedPackageRoots) ||
    isFamilyCovered(normalized, policy.protectedPackageFamilies) ||
    isScopeCovered(normalized, policy.protectedScopes)
  );
}

function isAllowed(record, policy) {
  if (record.kind !== 'dynamic-import' || record.argumentKind !== 'literal') return false;
  return policy.allowedDynamicImports.some(
    (entry) => entry.path === record.path && entry.specifier === record.specifier,
  );
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function compareIssues(left, right) {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  const leftLine = left.line ?? -1;
  const rightLine = right.line ?? -1;
  if (leftLine !== rightLine) return leftLine - rightLine;
  const leftColumn = left.column ?? -1;
  const rightColumn = right.column ?? -1;
  if (leftColumn !== rightColumn) return leftColumn - rightColumn;
  if (left.code !== right.code) return left.code < right.code ? -1 : 1;
  return 0;
}

function compareRecords(left, right) {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  if (left.line !== right.line) return left.line - right.line;
  if (left.column !== right.column) return left.column - right.column;
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  return 0;
}

function toPublicRecord(record) {
  return {
    path: record.path,
    kind: record.kind,
    typeOnly: record.typeOnly,
    line: record.line,
    column: record.column,
    argumentKind: record.argumentKind,
  };
}

// File level pin gates. Pin failures stay errors, but existing source files
// are always decoded and checked normally afterwards: only the single
// non-literal record of a fully valid dynamic pin may pass.
function checkFilePins(files, policy, issues) {
  for (const pin of policy.pinnedFiles) {
    const bytes = files.get(pin.path);
    if (bytes === undefined) {
      issues.push({ severity: 'error', code: PIN_MISSING, path: pin.path });
    } else if (sha256Hex(bytes) !== pin.sha256) {
      issues.push({ severity: 'error', code: PIN_MISMATCH, path: pin.path });
    }
  }
  for (const pin of policy.pinnedDynamicImports) {
    const bytes = files.get(pin.path);
    if (bytes === undefined) {
      issues.push({ severity: 'error', code: PIN_MISSING, path: pin.path, line: pin.line });
      continue;
    }
    if (sha256Hex(bytes) !== pin.sha256) {
      issues.push({ severity: 'error', code: PIN_MISMATCH, path: pin.path, line: pin.line });
      continue;
    }
    if (!files.has(pin.targetPath)) {
      issues.push({
        severity: 'error',
        code: PIN_TARGET_MISSING,
        path: pin.path,
        line: pin.line,
      });
    }
  }
}

// A dynamic pin excuses a record only with fully valid file conditions:
// matching bytes and an existing target next to the single record match.
function isPinFileValid(pin, files) {
  const bytes = files.get(pin.path);
  return bytes !== undefined && sha256Hex(bytes) === pin.sha256 && files.has(pin.targetPath);
}

function matchingPinRecords(records, pin) {
  return records.filter(
    (record) =>
      record.kind === 'dynamic-import' && record.argumentKind === pin.argumentKind && record.line === pin.line,
  );
}

// Checks the module references of one decoded source. Infrastructure errors
// of the collector are rethrown unchanged, syntax issues pass through.
function checkFileRecords(filePath, source, files, policy, issues) {
  const { records, issues: syntaxIssues } = collectSourceImports({ path: filePath, source });
  issues.push(...syntaxIssues);
  const pin = policy.pinnedDynamicImports.find((entry) => entry.path === filePath);
  let pinMatches = null;
  let pinValid = false;
  if (pin !== undefined) {
    pinValid = isPinFileValid(pin, files);
    pinMatches = matchingPinRecords(records, pin);
    if (pinMatches.length !== 1) {
      issues.push({ severity: 'error', code: DYNAMIC_PIN_STALE, path: filePath, line: pin.line });
    }
  }
  const publicRecords = [];
  for (const record of records) {
    if (record.specifier === null) {
      const pinned =
        pin !== undefined &&
        pinValid &&
        record.kind === 'dynamic-import' &&
        record.argumentKind === pin.argumentKind &&
        record.line === pin.line &&
        pinMatches !== null &&
        pinMatches.length === 1;
      if (!pinned) {
        issues.push({
          severity: 'error',
          code: NON_LITERAL_IMPORT,
          path: record.path,
          line: record.line,
          column: record.column,
        });
      }
    } else {
      const normalized = normalizeSpecifier(record.specifier);
      if (isAllowed(record, policy)) {
        // Exact pair, nothing to report.
      } else if (record.path.startsWith('apps/web/') && isScopeCovered(normalized, policy.forbiddenWebScopes)) {
        issues.push({
          severity: 'error',
          code: WEB_SCOPE_FORBIDDEN,
          path: record.path,
          line: record.line,
          column: record.column,
        });
      } else if (isProtected(normalized, policy)) {
        issues.push({
          severity: 'error',
          code: IMPORT_FORBIDDEN,
          path: record.path,
          line: record.line,
          column: record.column,
        });
      }
    }
    publicRecords.push(toPublicRecord(record));
  }
  return publicRecords;
}

// Checks the source boundaries of repository file bytes against the
// versioned policy. Returns { records, issues } with safe metadata only,
// covering module references as well as manifest and lockfile entries.
export function checkSourceBoundaries(input = {}) {
  if (!isPlainObject(input) || !(input.files instanceof Map)) fail();
  for (const [filePath, bytes] of input.files) {
    if (!isMapPath(filePath) || !Buffer.isBuffer(bytes)) fail();
  }
  const policyBytes = input.files.get(POLICY_PATH);
  if (policyBytes === undefined) fail();
  let policy;
  try {
    policy = readSourceImportPolicy(JSON.parse(decodeUtf8(policyBytes)));
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'exitCode' in error) throw error;
    fail();
  }
  const issues = [];
  checkFilePins(input.files, policy, issues);
  const records = [];
  for (const [filePath, bytes] of input.files) {
    if (!CODE_EXTENSIONS.has(extensionOf(filePath))) continue;
    const source = decodeUtf8(bytes);
    records.push(...checkFileRecords(filePath, source, input.files, policy, issues));
  }
  checkManifestFiles(input.files, policy, issues);
  records.sort(compareRecords);
  issues.sort(compareIssues);
  return { records, issues };
}

// private closed-source packages must not appear as dependencies of the
// public repository, neither in manifests nor in lockfiles.
function checkManifestFiles(files, policy, issues) {
  const seen = new Set();
  for (const [filePath, bytes] of files) {
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    if (name !== 'package.json' && name !== 'package-lock.json' && name !== 'npm-shrinkwrap.json') continue;
    const source = decodeUtf8(bytes);
    if (name === 'package.json') {
      checkManifestDocument(filePath, source, policy, issues, seen);
    } else {
      checkLockDocument(filePath, source, policy, issues, seen);
    }
  }
}

function parseManifestDocument(source) {
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    fail();
  }
  if (!isPlainObject(document)) fail();
  return document;
}

function aliasTargetIsProtected(value, policy) {
  if (typeof value !== 'string' || !value.startsWith('npm:')) return false;
  const target = value.slice('npm:'.length);
  const at = target.lastIndexOf('@');
  const name = at > 0 ? target.slice(0, at) : target;
  return isProtected(normalizeSpecifier(name), policy);
}

function isPrivateDependency(name, value, policy) {
  return isProtected(normalizeSpecifier(name), policy) || aliasTargetIsProtected(value, policy);
}

function findKeyLine(source, key) {
  const needle = `"${key}"`;
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes(needle)) return index + 1;
  }
  return undefined;
}

function pushManifestIssue(issues, seen, code, filePath, key, source) {
  const line = findKeyLine(source, key);
  const marker = `${filePath}${code}${line ?? ''}`;
  if (seen.has(marker)) return;
  seen.add(marker);
  const issue = { severity: 'error', code, path: filePath };
  if (line !== undefined) issue.line = line;
  issues.push(issue);
}

function checkDependencyMap(holder, policy, issues, seen, code, filePath, source) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const entries = holder[field];
    if (!isPlainObject(entries)) continue;
    for (const [name, value] of Object.entries(entries)) {
      if (isPrivateDependency(name, value, policy)) {
        pushManifestIssue(issues, seen, code, filePath, name, source);
      }
    }
  }
}

function checkManifestDocument(filePath, source, policy, issues, seen) {
  const document = parseManifestDocument(source);
  checkDependencyMap(document, policy, issues, seen, MANIFEST_PRIVATE, filePath, source);
}

function checkLockDocument(filePath, source, policy, issues, seen) {
  const document = parseManifestDocument(source);
  if (!isPlainObject(document.packages)) return;
  for (const [key, entry] of Object.entries(document.packages)) {
    if (key.length === 0) continue;
    const marker = 'node_modules/';
    const at = key.lastIndexOf(marker);
    const packageName = at === -1 ? null : key.slice(at + marker.length);
    if (packageName !== null && packageName.length > 0) {
      if (isProtected(normalizeSpecifier(packageName), policy)) {
        pushManifestIssue(issues, seen, LOCK_PRIVATE, filePath, key, source);
      }
    }
    if (!isPlainObject(entry)) continue;
    if (typeof entry.name === 'string' && isProtected(normalizeSpecifier(entry.name), policy)) {
      pushManifestIssue(issues, seen, LOCK_PRIVATE, filePath, entry.name, source);
    }
    checkDependencyMap(entry, policy, issues, seen, LOCK_PRIVATE, filePath, source);
  }
}
