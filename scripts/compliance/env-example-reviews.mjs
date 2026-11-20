// Pure composition of the strict env example check and the review register.
//
// The wrapper calls the unchanged strict checker, reads the fixed register
// file from the passed-in map and applies exactly bound single approvals.
// No file system, no network and no process env; inputs are never mutated.
import { createHash } from 'node:crypto';
import { checkEnvExamples } from './env-examples.mjs';
import { isEnvExampleReviewDataError, parseEnvExampleReviewData } from './env-example-review-data.mjs';

const REGISTER_PATH = 'compliance/env-example-reviews.json';
const DATA_INVALID_MESSAGE = 'The compliance data is invalid.';
const REVIEW_FAILED_MESSAGE = 'The check of the example approvals failed.';
const REVIEW_UNUSED = 'ENV_EXAMPLE_REVIEW_UNUSED';
const REVIEW_STALE = 'ENV_EXAMPLE_REVIEW_STALE';
const ACCEPTED_CODE = new Map([
  ['ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED', 'ENV_EXAMPLE_CREDENTIAL_REVIEW_ACCEPTED'],
  ['ENV_EXAMPLE_ADDRESS_REVIEW_REQUIRED', 'ENV_EXAMPLE_ADDRESS_REVIEW_ACCEPTED'],
  ['ENV_EXAMPLE_VALUE_REVIEW_REQUIRED', 'ENV_EXAMPLE_VALUE_REVIEW_ACCEPTED'],
]);

// Identity registry for this module's own errors: only registered instances
// pass the catch guards below, every foreign error becomes the constant failure.
const reviewErrors = new WeakSet();

function failData() {
  const error = new Error(DATA_INVALID_MESSAGE);
  error.code = 'COMPLIANCE_DATA_INVALID';
  error.exitCode = 2;
  reviewErrors.add(error);
  throw error;
}

function failReview() {
  const error = new Error(REVIEW_FAILED_MESSAGE);
  error.code = 'COMPLIANCE_ENV_EXAMPLE_REVIEW_FAILED';
  error.exitCode = 2;
  reviewErrors.add(error);
  throw error;
}

function isOwnError(error) {
  try {
    return reviewErrors.has(error);
  } catch {
    return false;
  }
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// First own boundary: option reads only, the strict call stays outside.
function prepare(options) {
  try {
    if (!isPlainObject(options)) failData();
    const files = options.files;
    const objectFormat = options.objectFormat;
    if (!(files instanceof Map)) failData();
    if (objectFormat !== 'sha1') failData();
    return files;
  } catch (error) {
    if (isOwnError(error)) throw error;
    failReview();
  }
}

// Whole git blob identity over the complete template bytes.
function blobOf(cache, path, bytes) {
  const known = cache.get(path);
  if (known !== undefined) return known;
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  const digest = createHash('sha1').update(header).update(bytes).digest('hex');
  cache.set(path, digest);
  return digest;
}

function unusedIssue(path, line) {
  return { code: REVIEW_UNUSED, path, severity: 'error', line };
}

function staleIssue(path, line) {
  return { code: REVIEW_STALE, path, severity: 'error', line };
}

function applyReviews(strict, files) {
  const register = files.get(REGISTER_PATH);
  const data = parseEnvExampleReviewData({ bytes: register, objectFormat: 'sha1' });
  const issues = [...strict.issues];
  const cache = new Map();
  for (const entry of data.approvals) {
    const target = files.get(entry.path);
    if (target === undefined) {
      issues.push(unusedIssue(entry.path, entry.line));
      continue;
    }
    if (blobOf(cache, entry.path, target) !== entry.blobOid) {
      issues.push(staleIssue(entry.path, entry.line));
      continue;
    }
    const index = issues.findIndex(
      (issue) => issue.path === entry.path && issue.line === entry.line && issue.code === entry.code,
    );
    if (index < 0) {
      issues.push(unusedIssue(entry.path, entry.line));
    } else {
      issues[index] = {
        code: ACCEPTED_CODE.get(entry.code),
        path: entry.path,
        severity: 'info',
        line: entry.line,
      };
    }
  }
  issues.sort(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      compareStrings(left.code, right.code),
  );
  return { records: strict.records, issues };
}

// Second own boundary: decoder errors pass via their identity, foreign errors
// become the constant review failure.
function finish(strict, files) {
  try {
    return applyReviews(strict, files);
  } catch (error) {
    if (isEnvExampleReviewDataError(error)) throw error;
    if (isOwnError(error)) throw error;
    failReview();
  }
}

// Pure composition without FS, network or env access in the module.
export function checkEnvExampleReviews(options) {
  const files = prepare(options);
  const strict = checkEnvExamples({ files });
  return finish(strict, files);
}
