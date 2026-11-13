// Commit sign-off compliance check.
//
// Pure structured validation over commit metadata that a Git adapter already
// extracted (for example via `git interpret-trailers --parse --no-divider`).
// This module never reads the repository, the network, the file system or
// child processes: it only validates the given shape and compares each
// author against the Signed-off-by trailers of the same commit.
//
// A commit passes when at least one Signed-off-by trailer carries exactly
// `Name <mail>` (after an outer trim) with a normalized name and a
// case-insensitive mail match. Extra foreign or malformed sign-offs do not
// change a pass. Results carry only oids, booleans, severities and codes.

const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TRAILER_KEY_PATTERN = /^[A-Za-z0-9-]+$/;
const SIGNOFF_KEY = 'signed-off-by';
// Control and line-separator characters. Horizontal tab is allowed because
// name comparison collapses it; every other control char fails validation.
const FORBIDDEN_TEXT_CHARS = /[\x00-\x08\x0a-\x1f\x7f\u0080-\u009f\u2028\u2029]/;
const FORBIDDEN_MAIL_CHARS = /[\x00-\x1f\x7f\u0080-\u009f]/;
const WHITESPACE_OR_BRACKETS = /[\s<>]/;
const INNER_WHITESPACE = /[ \t]+/g;

function fail() {
  const error = new Error(DATA_INVALID_MESSAGE);
  error.code = 'COMPLIANCE_DATA_INVALID';
  throw error;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) return false;
  }
  return true;
}

function isAuthorName(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.trim().length === 0) return false;
  return !FORBIDDEN_TEXT_CHARS.test(value);
}

function isMailAddress(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (WHITESPACE_OR_BRACKETS.test(value)) return false;
  if (FORBIDDEN_MAIL_CHARS.test(value)) return false;
  const parts = value.split('@');
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}

function isTrailerKey(value) {
  return typeof value === 'string' && TRAILER_KEY_PATTERN.test(value);
}

function isTrailerValue(value) {
  return typeof value === 'string' && !FORBIDDEN_TEXT_CHARS.test(value);
}

// NFC-normalize, drop outer whitespace, collapse inner spaces and tabs.
function normalizeName(value) {
  return value.normalize('NFC').trim().replace(INNER_WHITESPACE, ' ');
}

// Split an outer-trimmed value into name and mail. Returns null unless the
// value is exactly `Name <mail>` with no trailing suffix.
function parseSignoff(value) {
  const trimmed = value.trim();
  if (!trimmed.endsWith('>')) return null;
  const opener = trimmed.lastIndexOf('<');
  if (opener < 0) return null;
  const name = normalizeName(trimmed.slice(0, opener));
  const mail = trimmed.slice(opener + 1, trimmed.length - 1);
  if (name.length === 0 || mail.length === 0) return null;
  return { name, mail };
}

function validateTrailer(entry) {
  if (!isObject(entry)) fail();
  if (!isTrailerKey(entry.key)) fail();
  if (!isTrailerValue(entry.value)) fail();
}

function validateCommit(entry, seenOids) {
  if (!isObject(entry)) fail();
  if (typeof entry.oid !== 'string' || !OID_PATTERN.test(entry.oid)) fail();
  if (seenOids.has(entry.oid)) fail();
  seenOids.add(entry.oid);
  if (!isObject(entry.author)) fail();
  if (!isAuthorName(entry.author.name)) fail();
  if (!isMailAddress(entry.author.email)) fail();
  if (!isDenseArray(entry.trailers)) fail();
  for (const trailer of entry.trailers) {
    validateTrailer(trailer);
  }
}

function validateInput(input) {
  if (!isObject(input)) fail();
  if (!isDenseArray(input.commits)) fail();
  const seenOids = new Set();
  for (const entry of input.commits) {
    validateCommit(entry, seenOids);
  }
}

function matchesAuthor(author, signoffValue) {
  const parsed = parseSignoff(signoffValue);
  if (parsed === null) return false;
  if (parsed.name !== normalizeName(author.name)) return false;
  return parsed.mail.toLowerCase() === author.email.toLowerCase();
}

function compareOid(left, right) {
  if (left.oid < right.oid) return -1;
  if (left.oid > right.oid) return 1;
  return 0;
}

export function checkCommitSignoffs(input) {
  validateInput(input);
  const ordered = [...input.commits].sort(compareOid);
  const records = [];
  const issues = [];
  for (const entry of ordered) {
    const signoffs = entry.trailers.filter((trailer) => trailer.key.toLowerCase() === SIGNOFF_KEY);
    const hasSignoff = signoffs.length > 0;
    const authorMatched = hasSignoff && signoffs.some((trailer) => matchesAuthor(entry.author, trailer.value));
    records.push({ commit: entry.oid, hasSignoff, authorMatched });
    if (!hasSignoff) {
      issues.push({ severity: 'error', code: 'COMMIT_SIGNOFF_MISSING', commit: entry.oid });
    } else if (!authorMatched) {
      issues.push({
        severity: 'error',
        code: 'COMMIT_SIGNOFF_AUTHOR_MISMATCH',
        commit: entry.oid,
      });
    }
  }
  return { records, issues };
}
