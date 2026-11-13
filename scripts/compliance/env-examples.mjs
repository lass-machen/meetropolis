// Strict check for versioned env example templates.
//
// The checker works exclusively on a passed-in map of path
// and file bytes: no file system, no network and no process env.
// It selects only example basenames like the git reader, never reads real
// env names by content and reports only path, line number as well as fixed
// class, code and severity. Keys, values, parser texts and hashes stay inside.

import { matchSafeDefault, readSafeDefaults } from './env-example-defaults.mjs';

const DATA_INVALID_MESSAGE = 'The compliance data is invalid.';
const ENV_FAILED_MESSAGE = 'The check of the example templates failed.';
const POLICY_PATH = 'compliance/policy.json';
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Example basenames like the git reader, case-sensitive.
const ENV_EXAMPLE_BASENAME = /^\.env(?:\.[A-Za-z0-9_-]+)*\.example$/;
// Real env names, case-insensitive: content is never read.
const DOTENV_BASENAME = /\.env(?:\.|$)/i;
// Special characters only by code point, so no control character sits in the source.
const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);
const BOM = String.fromCharCode(65279);
const LINE_SEP = String.fromCharCode(8232);
const PARA_SEP = String.fromCharCode(8233);
const DOUBLE_QUOTE = '"';
const SINGLE_QUOTE = String.fromCharCode(39);
const BACKSLASH = String.fromCharCode(92);
const BACKTICK = String.fromCharCode(96);
const HASH = '#';
const LEAD_WS = new RegExp('^[ ' + TAB + ']*');
const COMMENT_PATTERN = new RegExp('^[ ' + TAB + ']*#(.*)$');
const decoder = new TextDecoder('utf-8', { fatal: true });

// Identity registry for failData errors: only registered instances pass the
// catch guard below, every foreign error becomes the constant failure.
const dataErrors = new WeakSet();

function failData() {
  const error = new Error(DATA_INVALID_MESSAGE);
  error.code = 'COMPLIANCE_DATA_INVALID';
  error.exitCode = 2;
  dataErrors.add(error);
  throw error;
}

function failEnvExample() {
  const error = new Error(ENV_FAILED_MESSAGE);
  error.code = 'COMPLIANCE_ENV_EXAMPLE_FAILED';
  error.exitCode = 2;
  throw error;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Control characters without tab and CR: both are matched specifically elsewhere.
function isControlChar(value) {
  const code = value.charCodeAt(0);
  if (code <= 8) return true;
  if (code === 11 || code === 12) return true;
  if (code >= 14 && code <= 31) return true;
  if (code >= 127 && code <= 159) return true;
  return value === LINE_SEP || value === PARA_SEP;
}

function hasControlText(text) {
  for (const value of text) {
    if (isControlChar(value)) return true;
  }
  return false;
}

// Same control set as the git reader (git-files.mjs): C0 and C1 controls
// plus line and paragraph separators.
function isRepoPathControl(value) {
  const code = value.codePointAt(0);
  if (code <= 0x1f) return true;
  if (code >= 0x7f && code <= 0x9f) return true;
  return code === 0x2028 || code === 0x2029;
}

function isBlank(text) {
  for (const value of text) {
    if (value !== ' ' && value !== TAB) return false;
  }
  return true;
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
  return name;
}

// Key lists are non-empty, validly named and unique within themselves.
function validateKeyList(value) {
  if (!Array.isArray(value) || value.length === 0) failData();
  const seen = new Set();
  for (const key of value) {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) failData();
    if (seen.has(key)) failData();
    seen.add(key);
  }
  return seen;
}

// The policy provides exactly the two role lists and nothing else, apart
// from the optional closed safeDefaults section validated separately.
function readPolicy(files) {
  const raw = files.get(POLICY_PATH);
  if (!Buffer.isBuffer(raw)) failData();
  let policy = null;
  try {
    policy = JSON.parse(raw.toString('utf8'));
  } catch {
    failData();
  }
  if (!isPlainObject(policy)) failData();
  const examples = policy.envExamples;
  if (!isPlainObject(examples)) failData();
  const keys = Object.keys(examples).sort();
  if (
    (keys.length !== 2 && keys.length !== 3) ||
    keys[0] !== 'addressKeys' ||
    keys[1] !== 'credentialKeys' ||
    (keys.length === 3 && keys[2] !== 'safeDefaults')
  ) {
    failData();
  }
  const credentialKeys = validateKeyList(examples.credentialKeys);
  const addressKeys = validateKeyList(examples.addressKeys);
  for (const key of credentialKeys) {
    if (addressKeys.has(key)) failData();
  }
  const safeDefaults = readSafeDefaults(examples.safeDefaults, { failData, credentialKeys, addressKeys });
  return { credentialKeys, addressKeys, safeDefaults };
}

function decodeLine(chunk) {
  try {
    return decoder.decode(chunk);
  } catch {
    return null;
  }
}

// BOM is detected at byte level: the decoder would silently remove it.
function startsWithBom(chunk) {
  return chunk.length >= 3 && chunk[0] === 239 && chunk[1] === 187 && chunk[2] === 191;
}

// Value by rules 3 and 4: empty, unquoted or exactly one quote pair.
function validateValue(raw) {
  if (raw === '') return { ok: true, value: '' };
  const first = raw[0];
  if (first === DOUBLE_QUOTE || first === SINGLE_QUOTE) {
    if (raw.length < 2 || raw[raw.length - 1] !== first) return { ok: false, value: '' };
    const inner = raw.slice(1, -1);
    if (inner.includes(first)) return { ok: false, value: '' };
    if (inner.includes(BACKSLASH)) return { ok: false, value: '' };
    if (inner.includes(TAB)) return { ok: false, value: '' };
    if (inner.includes(BOM)) return { ok: false, value: '' };
    if (hasControlText(inner)) return { ok: false, value: '' };
    return { ok: true, value: inner };
  }
  if (first === ' ' || first === TAB) return { ok: false, value: '' };
  const last = raw[raw.length - 1];
  if (last === ' ' || last === TAB) return { ok: false, value: '' };
  if (raw.includes(HASH)) return { ok: false, value: '' };
  if (raw.includes(DOUBLE_QUOTE) || raw.includes(SINGLE_QUOTE)) {
    return { ok: false, value: '' };
  }
  if (raw.includes(BACKTICK)) return { ok: false, value: '' };
  if (raw.includes(BACKSLASH)) return { ok: false, value: '' };
  if (raw.includes(TAB)) return { ok: false, value: '' };
  if (raw.includes(BOM)) return { ok: false, value: '' };
  return { ok: true, value: raw };
}

// Assignment candidate by rules 3 and 4, otherwise null.
function parseAssignment(text) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(text);
  if (match === null) return null;
  const checked = validateValue(match[2]);
  if (!checked.ok) return null;
  return { key: match[1], value: checked.value };
}

// Content precedence by rule 7: userinfo, roles, URL host, rest.
function reviewValue(key, value, roles) {
  if (value === '') return null;
  let url = null;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (url !== null && (url.username !== '' || url.password !== '')) {
    return 'ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED';
  }
  if (roles.credentialKeys.has(key)) return 'ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED';
  if (roles.addressKeys.has(key)) return 'ENV_EXAMPLE_ADDRESS_REVIEW_REQUIRED';
  if (url !== null && url.host !== '') return 'ENV_EXAMPLE_ADDRESS_REVIEW_REQUIRED';
  return 'ENV_EXAMPLE_VALUE_REVIEW_REQUIRED';
}

// One example file: every physical line gets exactly one record.
function checkFile(path, bytes, roles) {
  const chunks = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 10) {
      chunks.push(bytes.subarray(start, index));
      start = index + 1;
    }
  }
  if (start < bytes.length) chunks.push(bytes.subarray(start));
  const records = [];
  const issues = [];
  const activeKeys = new Set();
  const commentedKeys = new Set();
  let proseReported = false;
  const syntaxIssue = (line) => {
    issues.push({ code: 'ENV_EXAMPLE_SYNTAX_UNSUPPORTED', path, severity: 'error', line });
  };
  const contentIssue = (line, code) => {
    issues.push({ code, path, severity: 'error', line });
  };
  const acceptedIssue = (line, match) => {
    issues.push({
      code: 'ENV_EXAMPLE_DEFAULT_ACCEPTED',
      path,
      severity: 'info',
      line,
      status: 'ACCEPTED',
      ruleId: match.ruleId,
      reviewCode: match.reviewCode,
    });
  };
  // A closed safe default replaces exactly its content finding; every other
  // finding on the same line stays untouched.
  const contentOrAccepted = (line, key, value, code, safeDefaults) => {
    const match = code === null ? null : matchSafeDefault(key, value, safeDefaults);
    if (match !== null && match.reviewCode === code) {
      acceptedIssue(line, match);
    } else if (code !== null) {
      contentIssue(line, code);
    }
  };
  chunks.forEach((chunk, position) => {
    const line = position + 1;
    if (startsWithBom(chunk)) {
      records.push({ kind: 'unsupported', line, path });
      syntaxIssue(line);
      return;
    }
    const text = decodeLine(chunk);
    if (text === null) {
      records.push({ kind: 'unsupported', line, path });
      syntaxIssue(line);
      return;
    }
    let body = text;
    // Strip a trailing CR only when this chunk was terminated by LF, otherwise
    // the remaining CR hits the syntax guard below.
    const terminated = position < chunks.length - 1 || bytes[bytes.length - 1] === 10;
    if (terminated && body.endsWith(CR)) body = body.slice(0, -1);
    if (body.includes(CR) || body.includes(BOM) || hasControlText(body)) {
      records.push({ kind: 'unsupported', line, path });
      syntaxIssue(line);
      return;
    }
    if (isBlank(body)) {
      records.push({ kind: 'empty', line, path });
      return;
    }
    const comment = COMMENT_PATTERN.exec(body);
    if (comment !== null) {
      const rest = comment[1].replace(LEAD_WS, '');
      if (rest === '') {
        records.push({ kind: 'comment', line, path });
        return;
      }
      if (rest.includes('=')) {
        const parsed = parseAssignment(rest);
        if (parsed === null) {
          records.push({ kind: 'unsupported_commented_assignment', line, path });
          syntaxIssue(line);
          return;
        }
        records.push({ kind: 'commented_assignment', line, path });
        if (commentedKeys.has(parsed.key)) {
          contentIssue(line, 'ENV_EXAMPLE_DUPLICATE_KEY');
        } else {
          commentedKeys.add(parsed.key);
        }
        const code = reviewValue(parsed.key, parsed.value, roles);
        contentOrAccepted(line, parsed.key, parsed.value, code, roles.safeDefaults);
        return;
      }
      records.push({ kind: 'comment', line, path });
      if (!proseReported) {
        proseReported = true;
        issues.push({
          code: 'ENV_EXAMPLE_PROSE_SECRET_SCAN_DEFERRED',
          path,
          severity: 'info',
          line,
        });
      }
      return;
    }
    const parsed = parseAssignment(body);
    if (parsed === null) {
      records.push({ kind: 'unsupported', line, path });
      syntaxIssue(line);
      return;
    }
    records.push({ kind: 'assignment', line, path });
    if (activeKeys.has(parsed.key)) {
      contentIssue(line, 'ENV_EXAMPLE_DUPLICATE_KEY');
    } else {
      activeKeys.add(parsed.key);
    }
    const code = reviewValue(parsed.key, parsed.value, roles);
    contentOrAccepted(line, parsed.key, parsed.value, code, roles.safeDefaults);
  });
  return { records, issues };
}

function runCheck(options) {
  if (!isPlainObject(options)) failData();
  const files = options.files;
  if (!(files instanceof Map)) failData();
  for (const [name, bytes] of files) {
    validatePath(name);
    if (!Buffer.isBuffer(bytes)) failData();
  }
  const roles = readPolicy(files);
  const records = [];
  const issues = [];
  const names = [...files.keys()].sort();
  for (const name of names) {
    if (name === POLICY_PATH) continue;
    const parts = name.split('/');
    const basename = parts[parts.length - 1];
    if (ENV_EXAMPLE_BASENAME.test(basename)) {
      const result = checkFile(name, files.get(name), roles);
      for (const record of result.records) records.push(record);
      for (const issue of result.issues) issues.push(issue);
    } else if (DOTENV_BASENAME.test(basename)) {
      issues.push({ code: 'ENV_FILE_TRACKED', path: name, severity: 'error' });
    }
  }
  records.sort((left, right) => compareStrings(left.path, right.path) || left.line - right.line);
  issues.sort(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      compareStrings(left.code, right.code),
  );
  return { records, issues };
}

// Pure check without FS, network or env access in the module.
export function checkEnvExamples(options) {
  try {
    return runCheck(options);
  } catch (error) {
    if (error !== null && typeof error === 'object' && dataErrors.has(error)) {
      throw error;
    }
    failEnvExample();
  }
}
