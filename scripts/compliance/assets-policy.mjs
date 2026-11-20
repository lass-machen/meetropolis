// Policy schema helpers for the deterministic local asset check.
//
// Holds the schema constants and the snapshot/policy/manifest readers used by
// checkAssets. No hashing, no license evaluation and no issue logic lives here.

const POLICY_PATH = 'compliance/policy.json';
const ASSETS_PATH = 'compliance/assets.json';
const FORBIDDEN_PATH = 'compliance/forbidden-characters.json';
const SCHEMA_VERSION = 1;
const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';
const ORIGIN_KINDS = new Set(['repository', 'upstream', 'owner-confirmed', 'empty-placeholder', 'documented']);
const VERIFICATION_STATUSES = new Set(['verified', 'documented', 'review-required', 'owner-confirmed']);
const FORBIDDEN_CHARACTER_IDS = ['char_0', 'char_1', 'char_2', 'char_3', 'char_4', 'char_5'];
const FORBIDDEN_ENTRY_KEYS = new Set(['id', 'gitBlob', 'sha256']);
const INTERNAL_REFERENCE_PATTERNS = [/\.vord\//, /\/Users\//, /\/tmp\//, /\bF-(?:DOC|OPEN)-[A-Za-z0-9][A-Za-z0-9_-]*/];

function fail() {
  const error = new Error(DATA_INVALID_MESSAGE);
  error.code = 'COMPLIANCE_DATA_INVALID';
  throw error;
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

function isSha256Hex(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isSha1Hex(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function containsInternalReference(text) {
  if (typeof text !== 'string') return false;
  return INTERNAL_REFERENCE_PATTERNS.some((pattern) => pattern.test(text));
}

// Snapshot of repository relative paths to file bytes.
function readSnapshot(files) {
  if (!(files instanceof Map)) fail();
  const snapshot = new Map();
  for (const [key, value] of files) {
    if (!isSafeRelativePath(key)) fail();
    if (!Buffer.isBuffer(value)) fail();
    snapshot.set(key, value);
  }
  return snapshot;
}

function readJsonDocument(snapshot, path) {
  const bytes = snapshot.get(path);
  if (bytes === undefined) fail();
  let parsed = null;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail();
  }
  if (!isObject(parsed)) fail();
  return parsed;
}

function readExtensionList(value) {
  if (!Array.isArray(value) || value.length === 0) fail();
  const extensions = new Set();
  for (const raw of value) {
    if (typeof raw !== 'string' || !/^\.[a-z0-9]+$/i.test(raw)) fail();
    const name = raw.slice(1).toLowerCase();
    if (extensions.has(name)) fail();
    extensions.add(name);
  }
  return extensions;
}

function readLicenseIdList(value) {
  if (!Array.isArray(value) || value.length === 0) fail();
  const ids = [];
  for (const id of value) {
    if (!isNonEmptyString(id)) fail();
    if (ids.includes(id)) fail();
    ids.push(id);
  }
  return ids;
}

function readPathList(value) {
  if (!Array.isArray(value) || value.length === 0) fail();
  const paths = [];
  for (const candidate of value) {
    if (!isSafeRelativePath(candidate)) fail();
    if (paths.includes(candidate)) fail();
    paths.push(candidate);
  }
  return new Set(paths);
}

// Areas with their path assignment; the longest matching path wins.
function readAreas(value) {
  if (!Array.isArray(value) || value.length === 0) fail();
  const areas = [];
  const ids = new Set();
  const usedPaths = new Set();
  let rootFallbacks = 0;
  for (const area of value) {
    if (!isObject(area) || !isNonEmptyString(area.id)) fail();
    if (ids.has(area.id)) fail();
    ids.add(area.id);
    if (!Array.isArray(area.paths) || area.paths.length === 0) fail();
    const paths = [];
    for (const candidate of area.paths) {
      if (candidate !== '' && !isSafeRelativePath(candidate)) fail();
      if (usedPaths.has(candidate)) fail();
      usedPaths.add(candidate);
      if (candidate === '') rootFallbacks += 1;
      paths.push(candidate);
    }
    areas.push({ id: area.id, paths });
  }
  // Exactly one area owns the root fallback, so every path has an area.
  if (rootFallbacks !== 1) fail();
  return areas;
}

// Asset rules of the policy: media extensions, font exceptions and the
// license set of every area. The rules have to cover exactly the declared
// areas, so no license list can be missing or unknown.
function readAssetPolicy(value, areas) {
  if (!isObject(value)) fail();
  const extensions = readExtensionList(value.extensions);
  const fontExtensions = readExtensionList(value.fontExtensions);
  for (const fontExtension of fontExtensions) {
    if (!extensions.has(fontExtension)) fail();
  }
  if (!isObject(value.allowedLicensesByArea)) fail();
  const allowedLicensesByArea = new Map();
  const areaIds = areas.map((area) => area.id);
  for (const [areaId, ids] of Object.entries(value.allowedLicensesByArea)) {
    if (!areaIds.includes(areaId)) fail();
    allowedLicensesByArea.set(areaId, readLicenseIdList(ids));
  }
  for (const areaId of areaIds) {
    if (!allowedLicensesByArea.has(areaId)) fail();
  }
  return {
    extensions,
    fontExtensions,
    allowedLicensesByArea,
    fontLicenses: readLicenseIdList(value.fontLicenses),
    fontLicenseTexts: readPathList(value.fontLicenseTexts),
  };
}

function readPolicy(snapshot) {
  const document = readJsonDocument(snapshot, POLICY_PATH);
  if (document.schemaVersion !== SCHEMA_VERSION) fail();
  const areas = readAreas(document.areas);
  return { areas, assets: readAssetPolicy(document.assets, areas) };
}

// Committed manifest of the assets with their provenance and license.
function readManifest(snapshot) {
  const document = readJsonDocument(snapshot, ASSETS_PATH);
  if (document.schemaVersion !== SCHEMA_VERSION) fail();
  if (!Array.isArray(document.entries)) fail();
  const entries = [];
  const paths = new Set();
  for (const raw of document.entries) {
    if (!isObject(raw)) fail();
    if (!isSafeRelativePath(raw.path)) fail();
    if (paths.has(raw.path)) fail();
    paths.add(raw.path);
    if (!isSha256Hex(raw.sha256)) fail();
    if (!isNonEmptyString(raw.type)) fail();
    if (raw.license !== null && typeof raw.license !== 'string') fail();
    if (!isNonEmptyString(raw.copyright)) fail();
    if (!isObject(raw.origin)) fail();
    if (!ORIGIN_KINDS.has(raw.origin.kind)) fail();
    if (!isNonEmptyString(raw.origin.source)) fail();
    if (!isNonEmptyString(raw.origin.evidence)) fail();
    if (raw.origin.revision !== null && !isSha1Hex(raw.origin.revision)) fail();
    if (!VERIFICATION_STATUSES.has(raw.verification)) fail();
    if (raw.note !== undefined && typeof raw.note !== 'string') fail();
    entries.push({
      path: raw.path,
      sha256: raw.sha256,
      type: raw.type,
      license: raw.license,
      copyright: raw.copyright,
      origin: {
        kind: raw.origin.kind,
        source: raw.origin.source,
        revision: raw.origin.revision ?? null,
        evidence: raw.origin.evidence,
      },
      verification: raw.verification,
      note: typeof raw.note === 'string' ? raw.note : '',
    });
  }
  return { entries, paths };
}

// A source pin is a public https URL with a host and without credentials,
// query or hash; the revision is pinned separately.
function isValidSourceUrl(value) {
  if (!isNonEmptyString(value)) return false;
  let url = null;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.hostname.length === 0) return false;
  if (url.username.length > 0 || url.password.length > 0) return false;
  if (url.search.length > 0 || url.hash.length > 0) return false;
  return true;
}

// Fingerprint table of the forbidden characters: digests only, no image bytes.
function readForbiddenCharacters(snapshot) {
  const document = readJsonDocument(snapshot, FORBIDDEN_PATH);
  if (document.schemaVersion !== SCHEMA_VERSION) fail();
  if (!isObject(document.source)) fail();
  const url = document.source.url;
  if (!isValidSourceUrl(url)) fail();
  if (containsInternalReference(url)) fail();
  if (!isSha1Hex(document.source.revision)) fail();
  if (!Array.isArray(document.entries)) fail();
  if (document.entries.length !== FORBIDDEN_CHARACTER_IDS.length) fail();
  const digests = new Set();
  const blobs = new Set();
  const ids = new Set();
  for (const entry of document.entries) {
    if (!isObject(entry)) fail();
    if (!FORBIDDEN_CHARACTER_IDS.includes(entry.id)) fail();
    if (ids.has(entry.id)) fail();
    ids.add(entry.id);
    if (!isSha256Hex(entry.sha256)) fail();
    if (!isSha1Hex(entry.gitBlob)) fail();
    if (digests.has(entry.sha256) || blobs.has(entry.gitBlob)) fail();
    for (const key of Object.keys(entry)) {
      if (!FORBIDDEN_ENTRY_KEYS.has(key)) fail();
    }
    digests.add(entry.sha256);
    blobs.add(entry.gitBlob);
  }
  for (const id of FORBIDDEN_CHARACTER_IDS) {
    if (!ids.has(id)) fail();
  }
  return { digests, blobs };
}

export { containsInternalReference, fail, readForbiddenCharacters, readManifest, readPolicy, readSnapshot };
