// Deterministic local asset check.
//
// Compares the committed asset manifest with a repository snapshot:
//   - every media file needs a manifest entry with provenance, license and
//     a pinned origin revision,
//   - every manifest entry needs a file with the recorded digest,
//   - files whose bytes match the forbidden character table are reported
//     independent of name, extension and manifest entry,
//   - the license of every entry is evaluated with the SPDX expression
//     evaluator against the license set of its area.
//
// An asset candidate is a file with a configured media extension or a file
// with bytes that are no valid UTF-8 text. Plain text files without a media
// extension are no candidates, so a source tree stays free of findings. The
// candidate rule also decides whether a registered file needs a review.
//
// The check is pure: it reads only from the given snapshot map, never opens a
// file, never uses the network or node_modules, and neither writes nor prints
// anything.

import { createHash } from 'node:crypto';

import {
  containsInternalReference,
  fail,
  readForbiddenCharacters,
  readManifest,
  readPolicy,
  readSnapshot,
} from './assets-policy.mjs';
import { evaluateLicenseExpression } from './license-expression.mjs';

const UNKNOWN_LICENSE_MARKERS = ['unbekannt', 'unknown'];
const FORBIDDEN_ORIGIN_MARKER = 'pixel-agents';
const FORBIDDEN_ORIGIN_PATTERNS = [/char_[0-5]/, /characters\//];

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Git object id of a blob: sha1 over the object header and the content.
function gitBlobSha1(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

// Lowercase file extension without the dot; a dotfile has no extension.
function extensionOf(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

function normalizedType(type) {
  return String(type).replace(/^\./, '').toLowerCase();
}

// Bytes are binary when they contain a NUL byte or are no valid UTF-8 text.
function looksBinary(bytes) {
  if (bytes.includes(0)) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

// Area of a path: the longest matching area path wins, the root path is the
// fallback of every area.
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
  return best;
}

// License set of a path: the set of its area plus the font licenses for font
// files and for the listed font license texts. Without a valid area no
// license is allowed, not even a font license.
function allowedLicensesFor(path, areaId, policy) {
  const areaLicenses = policy.allowedLicensesByArea.get(areaId);
  if (areaLicenses === undefined) fail();
  const allowed = [...areaLicenses];
  const isFont = policy.fontExtensions.has(extensionOf(path)) || policy.fontLicenseTexts.has(path);
  if (isFont) allowed.push(...policy.fontLicenses);
  return allowed;
}

// A license that is explicitly marked as unknown is a red check, not a broken
// expression. An unknown license id is never replaced by a default license.
function evaluateLicense(license, allowed) {
  if (license === null || license.trim().length === 0) {
    return { code: 'ASSET_LICENSE_UNKNOWN', selected: [] };
  }
  const lower = license.toLowerCase();
  if (UNKNOWN_LICENSE_MARKERS.some((marker) => lower.includes(marker))) {
    return { code: 'ASSET_LICENSE_UNKNOWN', selected: [] };
  }
  const result = evaluateLicenseExpression(license, allowed);
  if (result.ok) return { code: null, selected: result.selected };
  if (result.code === 'LICENSE_EXPRESSION_INVALID') {
    return { code: 'ASSET_LICENSE_INVALID', selected: [] };
  }
  return { code: 'ASSET_LICENSE_NOT_ALLOWED', selected: [] };
}

// A declared origin on the forbidden character collection is reported. The
// check reads the declared text only and never judges similarity.
function declaresForbiddenOrigin(source) {
  if (typeof source !== 'string') return false;
  const lower = source.toLowerCase();
  if (!lower.includes(FORBIDDEN_ORIGIN_MARKER)) return false;
  return FORBIDDEN_ORIGIN_PATTERNS.some((pattern) => pattern.test(lower));
}

// Content checks of one manifest entry: file presence, digest, file type and
// the state of the declared placeholder.
function checkEntryContent(entry, bytes, isMedia, issues) {
  const path = entry.path;
  const isEmpty = bytes !== undefined && bytes.length === 0;
  if (bytes === undefined) {
    issues.push({ severity: 'error', code: 'ASSET_MANIFEST_STALE', path });
  } else if (sha256Hex(bytes) !== entry.sha256) {
    issues.push({ severity: 'error', code: 'ASSET_DIGEST_MISMATCH', path });
  }
  if (isMedia && normalizedType(entry.type) !== extensionOf(path)) {
    issues.push({ severity: 'error', code: 'ASSET_TYPE_MISMATCH', path });
  }
  if (entry.origin.kind === 'empty-placeholder' && bytes !== undefined && !isEmpty) {
    issues.push({ severity: 'error', code: 'ASSET_PLACEHOLDER_CHANGED', path });
  }
  if (isMedia && isEmpty && entry.origin.kind !== 'empty-placeholder') {
    issues.push({ severity: 'error', code: 'ASSET_EMPTY_UNDECLARED', path });
  }
}

// Origin checks of one manifest entry: open states, an unpinned revision, a
// declared origin on the forbidden collection and internal references.
function checkEntryOrigin(entry, isCandidate, issues) {
  const path = entry.path;
  // An open origin kind or status always needs a review. A documented status
  // of an asset candidate needs one as well, a documented status of a
  // registered text file is only reported as information.
  if (entry.origin.kind === 'documented' || entry.verification === 'review-required') {
    issues.push({ severity: 'error', code: 'ASSET_REVIEW_REQUIRED', path });
  }
  if (entry.verification === 'documented') {
    issues.push(
      isCandidate
        ? { severity: 'error', code: 'ASSET_REVIEW_REQUIRED', path }
        : { severity: 'info', code: 'ASSET_SOURCE_DOCUMENTED', path },
    );
  }
  if (entry.origin.revision === null) {
    issues.push({ severity: 'error', code: 'ASSET_SOURCE_UNPINNED', path });
  }
  if (declaresForbiddenOrigin(entry.origin.source)) {
    issues.push({ severity: 'error', code: 'ASSET_FORBIDDEN_ORIGIN', path });
  }
  if (
    containsInternalReference(entry.origin.source) ||
    containsInternalReference(entry.origin.evidence) ||
    containsInternalReference(entry.note)
  ) {
    issues.push({ severity: 'error', code: 'ASSET_INTERNAL_REFERENCE', path });
  }
}

// Asset candidates without an own manifest entry have no provenance.
function checkCandidate(path, bytes, isMedia, issues) {
  issues.push({ severity: 'error', code: 'ASSET_PROVENANCE_MISSING', path });
  if (isMedia && bytes.length === 0) {
    issues.push({ severity: 'error', code: 'ASSET_EMPTY_UNDECLARED', path });
  }
  return { path, sha256: sha256Hex(bytes), verification: null, selectedLicenses: [] };
}

// Checks the committed asset manifest against a repository snapshot.
// files: Map of repository relative path to file bytes, including the three
// compliance files of the policy, the manifest and the fingerprint table.
// A record is written for every manifest entry and for every asset candidate
// without an own entry.
// Returns { records, issues } and has no output or write side effects.
export function checkAssets({ files } = {}) {
  const snapshot = readSnapshot(files);
  const policy = readPolicy(snapshot);
  const manifest = readManifest(snapshot);
  const forbidden = readForbiddenCharacters(snapshot);
  const issues = [];
  const records = [];

  // Forbidden character bytes are detected in every snapshot file, no matter
  // of name, extension or manifest entry.
  for (const path of [...snapshot.keys()].sort(compareStrings)) {
    const bytes = snapshot.get(path);
    if (forbidden.digests.has(sha256Hex(bytes)) || forbidden.blobs.has(gitBlobSha1(bytes))) {
      issues.push({ severity: 'error', code: 'ASSET_FORBIDDEN_CHARACTER', path });
    }
  }

  for (const entry of manifest.entries) {
    const path = entry.path;
    const bytes = snapshot.get(path);
    const isMedia = policy.assets.extensions.has(extensionOf(path));
    // An asset candidate is a media file or a file with binary bytes.
    const isCandidate = isMedia || (bytes !== undefined && looksBinary(bytes));
    checkEntryContent(entry, bytes, isMedia, issues);
    checkEntryOrigin(entry, isCandidate, issues);
    const area = areaFor(path, policy.areas);
    if (area === null) fail();
    const allowed = allowedLicensesFor(path, area.id, policy.assets);
    const evaluated = evaluateLicense(entry.license, allowed);
    if (evaluated.code !== null) {
      issues.push({ severity: 'error', code: evaluated.code, path });
    }
    records.push({
      path,
      sha256: bytes === undefined ? entry.sha256 : sha256Hex(bytes),
      verification: entry.verification,
      selectedLicenses: evaluated.selected,
    });
  }

  for (const path of [...snapshot.keys()].sort(compareStrings)) {
    if (manifest.paths.has(path)) continue;
    const bytes = snapshot.get(path);
    const isMedia = policy.assets.extensions.has(extensionOf(path));
    if (!isMedia && !looksBinary(bytes)) continue;
    records.push(checkCandidate(path, bytes, isMedia, issues));
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
