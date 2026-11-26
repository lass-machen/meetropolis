// Git file snapshot reader for the license compliance check.
//
// Reads the regular files of one fixed commit into a map of repository
// relative path and file bytes. The snapshot comes exclusively from the Git
// objects of that commit: the working tree, the index, filters, link
// targets, submodules and the network are never read.
//
// Guard rails of this module:
//   - Git runs with an argument array, shell:false and an explicit pipe for
//     every stream, so no diagnostic of a child process reaches the caller.
//   - The child environment is a copy without any inherited GIT_* variable.
//     Global and system configuration are off, and every transport is
//     blocked.
//   - The commit has to be a full object id, no reference is resolved, and
//     the object type is checked before the tree is read.
//   - Every path of the tree is validated before any content is read.
//   - Only regular blobs are included. Symlinks, gitlinks and every other
//     mode stay outside the snapshot, and dotenv files are skipped by name.
//   - Size, count, protocol and deadline failures raise one constant error
//     without raw values and without a partial result.

import { execFileSync } from 'node:child_process';
import { devNull } from 'node:os';
import { isAbsolute } from 'node:path';

const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';
const GIT_ERROR_MESSAGE = 'git error: the git command failed, timed out or returned unusable data';
const MAX_TREE_ENTRIES = 20000;
const MAX_BLOB_BYTES = 16 * 1024 * 1024;
const MAX_PATH_SUM_BYTES = 64 * 1024 * 1024;
const TOTAL_TIMEOUT_MS = 10000;
const CALL_TIMEOUT_MS = 5000;
const METADATA_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const PAYLOAD_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const PAYLOAD_HEADER_OVERHEAD_BYTES = 128;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MODE_PATTERN = /^[0-7]{6}$/;
const SIZE_PATTERN = /^(?:0|[1-9][0-9]*)$/;
// C0 and C1 control characters plus the line and paragraph separators.
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;
const REGULAR_MODES = new Set(['100644', '100755']);
// A basename that contains ".env" followed by a dot or by the end of the
// name, case insensitive: .env, .env.local, name.env, name.env.local.
const DOTENV_NAME = /\.env(?:\.|$)/i;
// The permission relevant examples, case sensitive.
const ENV_EXAMPLE_NAME = /^\.env(?:\.[A-Za-z0-9_-]+)*\.example$/;

function failData() {
  const error = new Error(DATA_INVALID_MESSAGE);
  error.code = 'COMPLIANCE_DATA_INVALID';
  throw error;
}

function failGit() {
  const error = new Error(GIT_ERROR_MESSAGE);
  error.code = 'COMPLIANCE_GIT_ERROR';
  throw error;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

// The working directory has to be an absolute path without control
// characters.
function validateCwd(value) {
  if (typeof value !== 'string' || value.length === 0) failData();
  if (CONTROL_CHARACTERS.test(value)) failData();
  if (!isAbsolute(value)) failData();
  return value;
}

// Only a full object id is accepted, never a reference.
function validateCommit(value) {
  if (typeof value !== 'string') failData();
  if (!OID_PATTERN.test(value)) failData();
  return value;
}

// The flag is optional, but a given value has to be a boolean.
function validateIncludeEnvExamples(options) {
  if (!Object.hasOwn(options, 'includeEnvExamples')) return false;
  if (typeof options.includeEnvExamples !== 'boolean') failData();
  return options.includeEnvExamples;
}

// Copy of the process environment without any inherited GIT_* variable,
// plus the settings that make Git read only and offline.
function buildEnv() {
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase().startsWith('GIT_')) continue;
    const value = process.env[key];
    if (typeof value === 'string') env[key] = value;
  }
  env.GIT_CONFIG_GLOBAL = devNull;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_NO_LAZY_FETCH = '1';
  env.GIT_ALLOW_PROTOCOL = '';
  env.LC_ALL = 'C';
  env.LANG = 'C';
  return env;
}

// Runs one Git command and returns its output as bytes. Every failure of
// the process, of the deadline or of the output becomes one constant tool
// error.
function runGit(context, args, options = {}) {
  const remaining = context.deadline - Date.now();
  if (remaining <= 0) failGit();
  const timeout = Math.min(CALL_TIMEOUT_MS, remaining);
  let stdout;
  try {
    stdout = execFileSync('git', args, {
      cwd: context.cwd,
      env: context.env,
      input: options.input,
      maxBuffer: options.maxBuffer ?? METADATA_MAX_BUFFER_BYTES,
      timeout,
      killSignal: 'SIGKILL',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    failGit();
  }
  return stdout;
}

// Strict UTF-8 decoding of metadata output.
function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    failGit();
  }
}

// The object type of the commit has to be a commit.
function readObjectType(context) {
  return decodeUtf8(runGit(context, ['cat-file', '-t', context.commit])).trim();
}

// A repository relative path: no backslash, no leading slash, no empty, dot
// or dot dot segment and no control character.
function isValidRepoPath(value) {
  if (value.length === 0) return false;
  if (value.includes('\\')) return false;
  if (value.startsWith('/')) return false;
  if (CONTROL_CHARACTERS.test(value)) return false;
  for (const segment of value.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') return false;
  }
  return true;
}

// Reads the tree of the commit and validates every entry.
function readTreeEntries(context) {
  const output = decodeUtf8(runGit(context, ['ls-tree', '-r', '-z', '--full-tree', context.commit]));
  const records = output.split('\0');
  if (records.length > 0 && records[records.length - 1] === '') records.pop();
  if (records.length > MAX_TREE_ENTRIES) failGit();
  const entries = [];
  const seenPaths = new Set();
  for (const record of records) {
    const separator = record.indexOf('\t');
    if (separator < 0) failGit();
    const header = record.slice(0, separator);
    const filePath = record.slice(separator + 1);
    const parts = header.split(' ');
    if (parts.length !== 3) failGit();
    const [mode, type, oid] = parts;
    if (!MODE_PATTERN.test(mode)) failGit();
    if (!OID_PATTERN.test(oid)) failGit();
    if (!isValidRepoPath(filePath)) failGit();
    if (seenPaths.has(filePath)) failGit();
    seenPaths.add(filePath);
    entries.push({ mode, type, oid, path: filePath });
  }
  return entries;
}

// Decides for one entry whether it is part of the snapshot.
function classifyEntry(entry, includeEnvExamples) {
  if (!REGULAR_MODES.has(entry.mode)) return { code: 'GIT_MODE_UNSUPPORTED' };
  if (entry.type !== 'blob') failGit();
  const basename = entry.path.slice(entry.path.lastIndexOf('/') + 1);
  if (ENV_EXAMPLE_NAME.test(basename)) {
    return includeEnvExamples ? { included: true } : { code: 'ENV_EXAMPLE_PENDING' };
  }
  if (DOTENV_NAME.test(basename)) return { code: 'ENV_FILE_TRACKED' };
  return { included: true };
}

// Sizes of the given objects. Only the size is taken from the output, the
// content of an object is never requested here.
function readObjectSizes(context, oids) {
  const input = Buffer.from(`${oids.join('\n')}\n`, 'utf8');
  const output = decodeUtf8(runGit(context, ['cat-file', '--batch-check'], { input }));
  const lines = output.split('\n');
  if (lines.length !== oids.length + 1) failGit();
  const sizes = new Map();
  for (let index = 0; index < oids.length; index += 1) {
    const parts = lines[index].split(' ');
    if (parts.length !== 3) failGit();
    const [oid, type, sizeText] = parts;
    if (oid !== oids[index]) failGit();
    if (type !== 'blob') failGit();
    if (!SIZE_PATTERN.test(sizeText)) failGit();
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size)) failGit();
    sizes.set(oid, size);
  }
  return sizes;
}

// Reads the content of the given blobs with one batch call. The binary
// protocol is parsed byte by byte: header, size bytes and a line feed.
function readBlobContents(context, oids, sizes) {
  const input = Buffer.from(`${oids.join('\n')}\n`, 'utf8');
  const maxBuffer = PAYLOAD_MAX_BUFFER_BYTES + MAX_TREE_ENTRIES * PAYLOAD_HEADER_OVERHEAD_BYTES;
  const output = runGit(context, ['cat-file', '--batch'], { input, maxBuffer });
  const contents = new Map();
  let offset = 0;
  for (const oid of oids) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) failGit();
    const parts = output.toString('latin1', offset, headerEnd).split(' ');
    if (parts.length !== 3) failGit();
    const [headerOid, type, sizeText] = parts;
    if (headerOid !== oid) failGit();
    if (type !== 'blob') failGit();
    if (!SIZE_PATTERN.test(sizeText)) failGit();
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size)) failGit();
    if (size !== sizes.get(oid)) failGit();
    const start = headerEnd + 1;
    const end = start + size;
    if (end + 1 > output.length) failGit();
    if (output[end] !== 0x0a) failGit();
    contents.set(oid, output.subarray(start, end));
    offset = end + 1;
  }
  if (offset !== output.length) failGit();
  return contents;
}

// Reads the regular files of one commit into a map of path and bytes.
// Returns { commit, files, skipped } and has no output side effect.
export function readGitFileSnapshot(options = {}) {
  if (!isPlainObject(options)) failData();
  const cwd = validateCwd(options.cwd);
  const commit = validateCommit(options.commit);
  const includeEnvExamples = validateIncludeEnvExamples(options);
  const context = {
    cwd,
    commit,
    env: buildEnv(),
    deadline: Date.now() + TOTAL_TIMEOUT_MS,
  };

  if (readObjectType(context) !== 'commit') failGit();

  const entries = readTreeEntries(context);
  const included = [];
  const skipped = [];
  for (const entry of entries) {
    const decision = classifyEntry(entry, includeEnvExamples);
    if (decision.included === true) included.push(entry);
    else skipped.push({ path: entry.path, code: decision.code });
  }

  const uniqueOids = [...new Set(included.map((entry) => entry.oid))].sort(compareStrings);
  const sizes = uniqueOids.length === 0 ? new Map() : readObjectSizes(context, uniqueOids);

  let pathSum = 0;
  for (const entry of included) {
    const size = sizes.get(entry.oid);
    if (size > MAX_BLOB_BYTES) failGit();
    pathSum += size;
  }
  if (pathSum > MAX_PATH_SUM_BYTES) failGit();

  const contents = uniqueOids.length === 0 ? new Map() : readBlobContents(context, uniqueOids, sizes);

  const files = new Map();
  for (const entry of [...included].sort((left, right) => compareStrings(left.path, right.path))) {
    files.set(entry.path, contents.get(entry.oid));
  }
  skipped.sort((left, right) => compareStrings(left.path, right.path));
  return { commit, files, skipped };
}
