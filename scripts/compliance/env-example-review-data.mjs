// Pure decoder for the versioned env example review register.
//
// The decoder works on passed-in bytes only: no file system, no network and
// no process env. It validates a closed JSON contract and returns a
// normalized dataset with deterministically sorted approvals. Blob identities
// are never computed here and no finding is waived; this is decoder input
// for a later composition step.
const DATA_INVALID_MESSAGE = 'The compliance data is invalid.';
const REVIEW_FAILED_MESSAGE = 'The check of the example approvals failed.';
// Example basenames like the git reader, case-sensitive.
const ENV_EXAMPLE_BASENAME = /^\.env(?:\.[A-Za-z0-9_-]+)*\.example$/;
const SHA1_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DECISION_REF_PATTERN = /^ENV-DECISION-[0-9]{3}$/;
const REVIEW_CODES = new Set([
  'ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED',
  'ENV_EXAMPLE_ADDRESS_REVIEW_REQUIRED',
  'ENV_EXAMPLE_VALUE_REVIEW_REQUIRED',
]);
const APPROVED_BY = new Set(['user', 'project-lead']);
const BACKSLASH = String.fromCharCode(92);
const decoder = new TextDecoder('utf-8', { fatal: true });

// Identity registry for decoder errors: only registered instances pass the
// catch guard below, every foreign error becomes the constant failure.
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

export function isEnvExampleReviewDataError(error) {
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

// Control set like the git reader: C0 and C1 controls plus line and
// paragraph separators.
function isRepoPathControl(value) {
  const code = value.codePointAt(0);
  if (code <= 0x1f) return true;
  if (code >= 0x7f && code <= 0x9f) return true;
  return code === 0x2028 || code === 0x2029;
}

// Repository relative paths like the git reader: no backslash, no leading
// slash, no empty, dot or dot-dot segment and no control character.
function validatePath(name) {
  if (typeof name !== 'string' || name.length === 0) failData();
  if (name[0] === '/') failData();
  if (name.includes(BACKSLASH)) failData();
  for (const value of name) {
    if (isRepoPathControl(value)) failData();
  }
  for (const segment of name.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') failData();
  }
  const basename = name.slice(name.lastIndexOf('/') + 1);
  if (!ENV_EXAMPLE_BASENAME.test(basename)) failData();
  return name;
}

// BOM is detected at byte level: the decoder would silently remove it.
function startsWithBom(chunk) {
  return chunk.length >= 3 && chunk[0] === 239 && chunk[1] === 187 && chunk[2] === 191;
}

function decodeBytes(chunk) {
  try {
    return decoder.decode(chunk);
  } catch {
    failData();
  }
}

function readRoot(text) {
  let root = null;
  try {
    root = JSON.parse(text);
  } catch {
    failData();
  }
  if (!isPlainObject(root)) failData();
  const keys = Object.keys(root).sort();
  if (keys.length !== 3 || keys[0] !== 'approvals' || keys[1] !== 'objectFormat' || keys[2] !== 'schemaVersion') {
    failData();
  }
  return root;
}

function readEntry(value, objectFormat) {
  if (!isPlainObject(value)) failData();
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 6 ||
    keys[0] !== 'approvedBy' ||
    keys[1] !== 'blobOid' ||
    keys[2] !== 'code' ||
    keys[3] !== 'decisionRef' ||
    keys[4] !== 'line' ||
    keys[5] !== 'path'
  ) {
    failData();
  }
  const entryPath = validatePath(value.path);
  if (!Number.isSafeInteger(value.line) || value.line <= 0) failData();
  if (typeof value.blobOid !== 'string') failData();
  if (objectFormat === 'sha1' ? !SHA1_PATTERN.test(value.blobOid) : !SHA256_PATTERN.test(value.blobOid)) {
    failData();
  }
  if (!REVIEW_CODES.has(value.code)) failData();
  if (!APPROVED_BY.has(value.approvedBy)) failData();
  if (typeof value.decisionRef !== 'string' || !DECISION_REF_PATTERN.test(value.decisionRef)) {
    failData();
  }
  return {
    path: entryPath,
    line: value.line,
    blobOid: value.blobOid,
    code: value.code,
    approvedBy: value.approvedBy,
    decisionRef: value.decisionRef,
  };
}

function runParse(options) {
  if (!isPlainObject(options)) failData();
  const bytes = options.bytes;
  const objectFormat = options.objectFormat;
  if (!Buffer.isBuffer(bytes)) failData();
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') failData();
  if (startsWithBom(bytes)) failData();
  const text = decodeBytes(bytes);
  const root = readRoot(text);
  if (root.schemaVersion !== 1) failData();
  if (root.objectFormat !== objectFormat) failData();
  if (!Array.isArray(root.approvals)) failData();
  const approvals = [];
  const seenTargets = new Set();
  const seenBlobs = new Map();
  for (const value of root.approvals) {
    const entry = readEntry(value, objectFormat);
    const target = `${entry.path}\n${entry.line}\n${entry.code}`;
    if (seenTargets.has(target)) failData();
    seenTargets.add(target);
    const knownBlob = seenBlobs.get(entry.path);
    if (knownBlob === undefined) {
      seenBlobs.set(entry.path, entry.blobOid);
    } else if (knownBlob !== entry.blobOid) {
      failData();
    }
    approvals.push(entry);
  }
  approvals.sort(
    (left, right) =>
      compareStrings(left.path, right.path) || left.line - right.line || compareStrings(left.code, right.code),
  );
  return { schemaVersion: 1, objectFormat, approvals };
}

// Pure decoder without FS, network or env access in the module.
export function parseEnvExampleReviewData(options) {
  try {
    return runParse(options);
  } catch (error) {
    if (isEnvExampleReviewDataError(error)) {
      throw error;
    }
    failReview();
  }
}
