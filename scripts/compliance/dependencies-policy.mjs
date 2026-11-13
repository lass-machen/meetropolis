// Policy schema readers for the offline production dependency check.
//
// Holds the schema constants and the snapshot/policy/evidence readers used
// by checkDependencies. No graph, license or record logic lives here.

const POLICY_PATH = 'compliance/policy.json';
const EVIDENCE_PATH = 'compliance/dependency-evidence.json';
const COMPLIANCE_PREFIX = 'compliance/';
const LICENSE_FILE_PREFIX = 'licenses/';
const SCHEMA_VERSION = 1;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Safe relative POSIX path without traversal, backslash or control chars.
function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  if (value.includes('\\')) return false;
  if (value.startsWith('/')) return false;
  if (/^[a-zA-Z]:($|\/)/.test(value)) return false;
  return value.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

// Same, but the repository root itself is a valid path.
function isSafeRepoPath(value) {
  return value === '' || isSafeRelativePath(value);
}

function isSha256Hex(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function dirnameOf(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

// Global workspace path of a lockfile root: lock directory plus root.
function globalPath(lockPath, root) {
  const dir = dirnameOf(lockPath);
  if (root === '') return dir;
  return dir === '' ? root : `${dir}/${root}`;
}

function parseJsonBytes(bytes, path, code) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(code, `invalid data: ${path} is not valid JSON`);
  }
  return parsed;
}

// Snapshot of repository relative paths to file bytes.
function readSnapshot(files) {
  if (!(files instanceof Map)) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: the snapshot must be a map of paths to bytes');
  }
  const snapshot = new Map();
  for (const [key, value] of files) {
    if (!isSafeRepoPath(key)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: the snapshot contains an unsafe path');
    }
    if (!Buffer.isBuffer(value)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: the snapshot contains a non-buffer value');
    }
    snapshot.set(key, value);
  }
  return snapshot;
}

// List of distinct, non-empty license ids.
function readIdList(value, label) {
  if (!Array.isArray(value)) {
    fail('COMPLIANCE_DATA_INVALID', `invalid data: ${label} must be a list of license ids`);
  }
  const ids = [];
  for (const id of value) {
    if (!isNonEmptyString(id)) {
      fail('COMPLIANCE_DATA_INVALID', `invalid data: ${label} contains an invalid license id`);
    }
    if (ids.includes(id)) {
      fail('COMPLIANCE_DATA_INVALID', `invalid data: ${label} contains a duplicate license id`);
    }
    ids.push(id);
  }
  return ids;
}

// Areas with their path assignment; a path may belong to one area only.
function readAreas(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: areas must be a non-empty list');
  }
  const areas = [];
  const areaIds = [];
  const pathOwner = new Map();
  let hasRootFallback = false;
  for (const area of value) {
    if (!isObject(area) || !isNonEmptyString(area.id)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: every area needs an id');
    }
    if (areaIds.includes(area.id)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: area ids must be unique');
    }
    areaIds.push(area.id);
    if (!Array.isArray(area.paths) || area.paths.length === 0) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: every area needs at least one path');
    }
    const paths = [];
    for (const candidate of area.paths) {
      if (!isSafeRepoPath(candidate)) {
        fail('COMPLIANCE_DATA_INVALID', 'invalid data: an area path is not a safe relative path');
      }
      if (pathOwner.has(candidate)) {
        fail('COMPLIANCE_DATA_INVALID', 'invalid data: an area path is assigned to more than one area');
      }
      pathOwner.set(candidate, area.id);
      if (candidate === '') hasRootFallback = true;
      paths.push(candidate);
    }
    const additionalAllowedLicenses = readIdList(area.additionalAllowedLicenses, 'additionalAllowedLicenses');
    areas.push({ id: area.id, paths, additionalAllowedLicenses });
  }
  if (!hasRootFallback) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: the area paths need a root fallback');
  }
  return areas;
}

function readReviewRequired(value) {
  if (!Array.isArray(value)) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: reviewRequired must be a list');
  }
  const ids = [];
  for (const entry of value) {
    if (!isObject(entry) || !isNonEmptyString(entry.id) || !isNonEmptyString(entry.reason)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: every reviewRequired entry needs an id and a reason');
    }
    if (ids.includes(entry.id)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: reviewRequired ids must be unique');
    }
    ids.push(entry.id);
  }
  return ids;
}

function readLockfiles(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: lockfiles must be a non-empty list');
  }
  const lockfiles = [];
  const paths = [];
  for (const entry of value) {
    if (!isObject(entry) || !isSafeRelativePath(entry.path)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: every lockfile needs a safe relative path');
    }
    if (paths.includes(entry.path)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: lockfile paths must be unique');
    }
    paths.push(entry.path);
    if (!Array.isArray(entry.roots) || entry.roots.length === 0) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: every lockfile needs at least one root');
    }
    const roots = [];
    for (const root of entry.roots) {
      if (!isSafeRepoPath(root)) {
        fail('COMPLIANCE_DATA_INVALID', 'invalid data: a lockfile root is not a safe relative path');
      }
      if (roots.includes(root)) {
        fail('COMPLIANCE_DATA_INVALID', 'invalid data: lockfile roots must be unique');
      }
      roots.push(root);
    }
    lockfiles.push({ path: entry.path, roots });
  }
  return lockfiles;
}

function readPolicy(snapshot) {
  const bytes = snapshot.get(POLICY_PATH);
  if (bytes === undefined) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: the compliance policy is missing');
  }
  const policy = parseJsonBytes(bytes, POLICY_PATH, 'COMPLIANCE_DATA_INVALID');
  if (!isObject(policy)) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: the compliance policy must be an object');
  }
  if (policy.schemaVersion !== SCHEMA_VERSION) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: unsupported compliance policy schema version');
  }
  return {
    commonAllowedLicenses: readIdList(policy.commonAllowedLicenses, 'commonAllowedLicenses'),
    areas: readAreas(policy.areas),
    reviewRequiredIds: readReviewRequired(policy.reviewRequired),
    lockfiles: readLockfiles(policy.lockfiles),
  };
}

// Evidence entries bound to a lockfile and lock path, with checked license
// texts. The file map is keyed by the repository relative path so that the
// evidence module receives the committed original bytes.
function readEvidence(snapshot) {
  const bytes = snapshot.get(EVIDENCE_PATH);
  if (bytes === undefined) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: the dependency evidence is missing');
  }
  const document = parseJsonBytes(bytes, EVIDENCE_PATH, 'COMPLIANCE_DATA_INVALID');
  if (!isObject(document) || document.schemaVersion !== SCHEMA_VERSION) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: unsupported dependency evidence schema version');
  }
  if (!Array.isArray(document.entries)) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: the dependency evidence needs an entries list');
  }
  const entries = [];
  const entryIds = [];
  const bindings = new Set();
  for (const entry of document.entries) {
    if (!isObject(entry) || !isNonEmptyString(entry.id)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: every evidence entry needs an id');
    }
    if (entryIds.includes(entry.id)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: evidence entry ids must be unique');
    }
    entryIds.push(entry.id);
    if (!isNonEmptyString(entry.name) || !isSafeRelativePath(entry.lockfile)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: an evidence entry has an invalid name or lockfile');
    }
    if (!isSafeRepoPath(entry.lockPath)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: an evidence entry has an invalid lock path');
    }
    const binding = `${entry.lockfile}::${entry.lockPath}`;
    if (bindings.has(binding)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: evidence entries must bind a lockfile and lock path once');
    }
    bindings.add(binding);
    if (!isNonEmptyString(entry.version) || !isNonEmptyString(entry.integrity)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: an evidence entry has an invalid version or integrity');
    }
    if (entry.rawLicense !== null && !isNonEmptyString(entry.rawLicense)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: an evidence entry has an invalid raw license value');
    }
    if (!isNonEmptyString(entry.license)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: an evidence entry has an invalid license value');
    }
    if (!Array.isArray(entry.files) || entry.files.length === 0) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: an evidence entry needs at least one license file');
    }
    const files = [];
    for (const file of entry.files) {
      if (!isObject(file) || !isSafeRelativePath(file.path)) {
        fail('COMPLIANCE_DATA_INVALID', 'invalid data: an evidence file has an invalid path');
      }
      if (!file.path.startsWith(LICENSE_FILE_PREFIX)) {
        fail('COMPLIANCE_DATA_INVALID', 'invalid data: an evidence file must live under the license folder');
      }
      if (!isSha256Hex(file.sha256)) {
        fail('COMPLIANCE_DATA_INVALID', 'invalid data: an evidence file has an invalid digest');
      }
      files.push({ path: `${COMPLIANCE_PREFIX}${file.path}`, sha256: file.sha256 });
    }
    entries.push({ ...entry, files });
  }
  const licenseFiles = new Map();
  for (const entry of entries) {
    for (const file of entry.files) {
      const content = snapshot.get(file.path);
      if (content !== undefined) licenseFiles.set(file.path, content);
    }
  }
  return { entries, licenseFiles };
}

// Explicitly added direct package names per global workspace path.
function readExtraDependencies(value, globalRoots) {
  if (!isObject(value)) {
    fail('COMPLIANCE_DATA_INVALID', 'invalid data: extraDependencies must be an object');
  }
  const extras = new Map();
  for (const [key, names] of Object.entries(value)) {
    if (!isSafeRepoPath(key)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: extraDependencies contains an unsafe path');
    }
    if (!globalRoots.has(key)) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: extraDependencies contains an unknown workspace path');
    }
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
      fail('COMPLIANCE_DATA_INVALID', 'invalid data: extraDependencies must map paths to package names');
    }
    extras.set(key, [...names]);
  }
  return extras;
}

// Global workspace paths of all configured lockfile roots.
function configuredGlobalRoots(lockfiles) {
  const roots = new Set();
  for (const lock of lockfiles) {
    for (const root of lock.roots) roots.add(globalPath(lock.path, root));
  }
  return roots;
}

export {
  configuredGlobalRoots,
  fail,
  globalPath,
  isNonEmptyString,
  isObject,
  parseJsonBytes,
  readEvidence,
  readExtraDependencies,
  readPolicy,
  readSnapshot,
};
