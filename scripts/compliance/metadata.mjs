// Deterministic local metadata check.
//
// Compares package manifests, license texts and dockerfiles found in a
// repository snapshot against the pinned metadata rules of the policy:
//   - every package.json needs a configured entry and the exact license
//     of its area,
//   - every configured license text needs to be present with the pinned
//     byte digest,
//   - every dockerfile needs a configured entry and exactly one explicit
//     licenses label with the exact license of its area in the final
//     stage; builder labels are never inherited.
//
// The check is pure: it reads only from the given snapshot map, never
// opens a file, never uses the network or node_modules, and neither
// writes nor prints anything.

import { createHash } from 'node:crypto';

import { DockerfileSyntaxError, parseDockerfile } from './metadata-dockerfile.mjs';

const POLICY_PATH = 'compliance/policy.json';
const SCHEMA_VERSION = 1;
const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';
const LICENSE_KEY = 'org.opencontainers.image.licenses';
const LICENSE_BASENAME = /^(?:LICENSE|LICENCE)(?:\..+)?$/i;

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

// A single SPDX id: ASCII letter or digit first, then only ASCII
// letters, digits, dots, plus signs or hyphens. Reserved operator
// words are no ids. No registry or network lookup is involved.
function isSpdxId(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value === 'AND' || value === 'OR' || value === 'WITH') return false;
  return /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(value);
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

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function basenameOf(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

function isDockerBasename(name) {
  return name === 'Dockerfile' || name.startsWith('Dockerfile.');
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

function readLicenseByArea(value, areas) {
  if (!isObject(value)) fail();
  const areaIds = areas.map((area) => area.id);
  for (const [areaId, license] of Object.entries(value)) {
    if (!areaIds.includes(areaId)) fail();
    if (!isSpdxId(license)) fail();
  }
  for (const areaId of areaIds) {
    if (!isSpdxId(value[areaId])) fail();
  }
  return new Map(Object.entries(value));
}

function readManifestList(value) {
  if (!Array.isArray(value) || value.length === 0) fail();
  const paths = [];
  for (const candidate of value) {
    if (!isSafeRelativePath(candidate)) fail();
    if (basenameOf(candidate) !== 'package.json') fail();
    if (paths.includes(candidate)) fail();
    paths.push(candidate);
  }
  return paths;
}

function readLicenseFileList(value) {
  if (!Array.isArray(value) || value.length === 0) fail();
  const entries = [];
  const paths = new Set();
  for (const raw of value) {
    if (!isObject(raw)) fail();
    if (!isSafeRelativePath(raw.path)) fail();
    if (!LICENSE_BASENAME.test(basenameOf(raw.path))) fail();
    if (paths.has(raw.path)) fail();
    paths.add(raw.path);
    if (!isSha256Hex(raw.sha256)) fail();
    entries.push({ path: raw.path, sha256: raw.sha256 });
  }
  return entries;
}

function readDockerList(value) {
  if (!Array.isArray(value) || value.length === 0) fail();
  const paths = [];
  for (const candidate of value) {
    if (!isSafeRelativePath(candidate)) fail();
    if (!isDockerBasename(basenameOf(candidate))) fail();
    if (paths.includes(candidate)) fail();
    paths.push(candidate);
  }
  return paths;
}

function readMetadataPolicy(value, areas) {
  if (!isObject(value)) fail();
  return {
    licenseByArea: readLicenseByArea(value.licenseByArea, areas),
    manifests: readManifestList(value.manifests),
    licenseFiles: readLicenseFileList(value.licenseFiles),
    dockerfiles: readDockerList(value.dockerfiles),
  };
}

function readPolicy(snapshot) {
  const document = readJsonDocument(snapshot, POLICY_PATH);
  if (document.schemaVersion !== SCHEMA_VERSION) fail();
  const areas = readAreas(document.areas);
  return { areas, metadata: readMetadataPolicy(document.metadata, areas) };
}

// Area of a path: the longest matching area path wins, the root path is
// the fallback of every area.
function areaFor(path, areas) {
  let best = null;
  let bestLength = -1;
  for (const area of areas) {
    for (const candidate of area.paths) {
      const matches = candidate === '' || path === candidate || path.startsWith(`${candidate}/`);
      if (matches && candidate.length > bestLength) {
        best = area;
        bestLength = candidate.length;
      }
    }
  }
  if (best === null) fail();
  return best;
}

// Checks the pinned package, license and docker metadata in a snapshot.
// files: Map of repository relative path to file bytes, including the
// policy. Returns { records, issues } and has no other side effects.
export function checkMetadata({ files } = {}) {
  const snapshot = readSnapshot(files);
  const policy = readPolicy(snapshot);
  const issues = [];
  const records = [];
  const expectedFor = (path) => {
    const license = policy.metadata.licenseByArea.get(areaFor(path, policy.areas).id);
    if (!isSpdxId(license)) fail();
    return license;
  };

  const configuredManifests = new Set(policy.metadata.manifests);
  for (const path of snapshot.keys()) {
    if (basenameOf(path) === 'package.json' && !configuredManifests.has(path)) {
      issues.push({ severity: 'error', code: 'METADATA_MANIFEST_UNCONFIGURED', path });
    }
  }
  for (const path of [...configuredManifests].sort(compareStrings)) {
    const bytes = snapshot.get(path);
    if (bytes === undefined) {
      issues.push({ severity: 'error', code: 'METADATA_MANIFEST_MISSING', path });
      continue;
    }
    let document = null;
    try {
      document = JSON.parse(bytes.toString('utf8'));
    } catch {
      issues.push({ severity: 'error', code: 'METADATA_MANIFEST_INVALID', path });
      continue;
    }
    if (!isObject(document)) {
      issues.push({ severity: 'error', code: 'METADATA_MANIFEST_INVALID', path });
      continue;
    }
    const expected = expectedFor(path);
    if (typeof document.license !== 'string' || document.license !== expected) {
      issues.push({ severity: 'error', code: 'METADATA_MANIFEST_LICENSE_MISMATCH', path });
    }
    records.push({ kind: 'manifest', path, expectedLicense: expected });
  }

  for (const entry of policy.metadata.licenseFiles) {
    const bytes = snapshot.get(entry.path);
    if (bytes === undefined) {
      issues.push({ severity: 'error', code: 'METADATA_LICENSE_FILE_MISSING', path: entry.path });
      continue;
    }
    if (sha256Hex(bytes) !== entry.sha256) {
      issues.push({ severity: 'error', code: 'METADATA_LICENSE_FILE_CHANGED', path: entry.path });
    }
    records.push({ kind: 'license-file', path: entry.path, expectedLicense: expectedFor(entry.path) });
  }

  const configuredDockers = new Set(policy.metadata.dockerfiles);
  for (const path of snapshot.keys()) {
    if (isDockerBasename(basenameOf(path)) && !configuredDockers.has(path)) {
      issues.push({ severity: 'error', code: 'METADATA_DOCKER_UNCONFIGURED', path });
    }
  }
  for (const path of [...configuredDockers].sort(compareStrings)) {
    const bytes = snapshot.get(path);
    if (bytes === undefined) {
      issues.push({ severity: 'error', code: 'METADATA_DOCKER_MISSING', path });
      continue;
    }
    const expected = expectedFor(path);
    let stages = null;
    try {
      stages = parseDockerfile(bytes.toString('utf8'));
    } catch (error) {
      if (error instanceof DockerfileSyntaxError) {
        issues.push({ severity: 'error', code: 'METADATA_DOCKER_SYNTAX_UNSUPPORTED', path });
      } else {
        issues.push({ severity: 'error', code: 'METADATA_DOCKER_INVALID', path });
      }
      continue;
    }
    const finalLabels = stages[stages.length - 1].filter((pair) => pair.key === LICENSE_KEY).map((pair) => pair.value);
    if (finalLabels.length === 0) {
      issues.push({ severity: 'error', code: 'METADATA_DOCKER_LICENSE_MISSING', path });
    } else if (finalLabels.length > 1) {
      issues.push({ severity: 'error', code: 'METADATA_DOCKER_LICENSE_DUPLICATE', path });
    } else if (finalLabels[0] !== expected) {
      issues.push({ severity: 'error', code: 'METADATA_DOCKER_LICENSE_MISMATCH', path });
    }
    records.push({ kind: 'dockerfile', path, expectedLicense: expected, finalStage: stages.length });
  }

  // Identical issues are reported once per file and code.
  const unique = new Map();
  for (const issue of issues) {
    unique.set(`${issue.severity}|${issue.code}|${issue.path}`, issue);
  }
  const sortedIssues = [...unique.values()].sort(
    (a, b) =>
      compareStrings(a.path, b.path) || compareStrings(a.code, b.code) || compareStrings(a.severity, b.severity),
  );
  const sortedRecords = records.sort((a, b) => compareStrings(a.path, b.path));
  return { records: sortedRecords, issues: sortedIssues };
}
