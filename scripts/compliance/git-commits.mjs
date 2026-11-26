// Git commit range reader for the commit sign-off compliance check.
//
// Reads the commits of one BASE..TARGET range from a local repository and
// returns the metadata that the pure validation in commits.mjs needs: object
// id, author, the full message and the trailers that Git itself parses.
//
// Guard rails of this module:
//   - Git runs with an argument array and shell:false, never through a shell,
//     and only with read commands (rev-parse, rev-list, show, merge-base,
//     interpret-trailers).
//   - The child environment is a copy of the current one without any
//     inherited GIT_* variable. Global and system configuration are off, and
//     terminal prompt, optional locks, replace objects, lazy fetch and every
//     transport are disabled.
//   - References are validated against a strict pattern before they reach
//     Git; every later Git call works with resolved object ids only.
//   - Failures raise one constant message with a stable error code. Raw Git
//     output, stderr and the original cause never leave this module.
//   - The result is complete or nothing: a failure throws instead of
//     returning a partial commit list.

import { execFileSync } from 'node:child_process';
import { devNull } from 'node:os';

const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';
const GIT_ERROR_MESSAGE = 'git error: the git command failed, timed out or returned unusable data';
const MAX_COMMITS = 2000;
const TOTAL_TIMEOUT_MS = 45000;
const CALL_TIMEOUT_MS = 5000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
// A reference starts with a letter or a digit, continues with letters,
// digits, dot, underscore, slash and dash and ends with optional ~N or ^N
// steps. Everything else (whitespace, control characters, reflog syntax,
// path syntax, shell syntax, leading options) is rejected.
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*(?:[~^][0-9]*)*$/;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;
const WHITESPACE = /\s/;

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

// The working directory has to be an absolute path without control
// characters; a relative path would depend on the caller's directory.
function validateCwd(value) {
  if (typeof value !== 'string' || value.length === 0) failData();
  if (CONTROL_CHARACTERS.test(value)) failData();
  if (!value.startsWith('/')) failData();
  return value;
}

function isValidRef(value) {
  if (value.length === 0) return false;
  if (value.includes('..')) return false;
  return REF_PATTERN.test(value);
}

// Splits BASE..TARGET. Three dot ranges, ranges with more than one pair and
// ranges with an empty side are invalid.
function parseRange(range) {
  if (typeof range !== 'string' || range.length === 0) failData();
  if (CONTROL_CHARACTERS.test(range) || WHITESPACE.test(range)) failData();
  const separator = range.indexOf('..');
  if (separator < 0) failData();
  const base = range.slice(0, separator);
  const target = range.slice(separator + 2);
  if (base.length === 0 || target.length === 0) failData();
  if (!isValidRef(base) || !isValidRef(target)) failData();
  return { base, target };
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

// Runs one Git command and returns its output as UTF-8 text. Every failure
// of the process, of the deadline or of the decoding becomes one constant
// tool error.
function runGit(context, args, input) {
  const remaining = context.deadline - Date.now();
  if (remaining <= 0) failGit();
  const timeout = Math.min(CALL_TIMEOUT_MS, remaining);
  let stdout;
  try {
    stdout = execFileSync('git', args, {
      cwd: context.cwd,
      env: context.env,
      input: input === undefined ? undefined : Buffer.from(input, 'utf8'),
      maxBuffer: MAX_BUFFER_BYTES,
      timeout,
      killSignal: 'SIGKILL',
      shell: false,
      // Without an explicit stdio, Node writes the stderr of the child to the
      // stderr of this process. The pipes keep every git diagnostic inside
      // this module, so only the constant error message can leave it.
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    failGit();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(stdout);
  } catch {
    failGit();
  }
}

// Resolves one reference to the full object id of its commit.
function resolveCommitOid(context, ref) {
  const output = runGit(context, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  const lines = output.split('\n').filter((line) => line.length > 0);
  if (lines.length !== 1) failGit();
  if (!OID_PATTERN.test(lines[0])) failGit();
  return lines[0];
}

// The base has to be an ancestor of the target, otherwise the range does not
// describe a forward history.
function requireAncestor(context, base, target) {
  runGit(context, ['merge-base', '--is-ancestor', base, target]);
}

// All commits that the target reaches and the base does not, in reverse
// topological order. Merge commits and their side branches are included.
function listCommits(context, base, target) {
  const output = runGit(context, ['rev-list', '--reverse', '--topo-order', `${base}..${target}`]);
  const oids = output.split('\n').filter((line) => line.length > 0);
  if (oids.length > MAX_COMMITS) failGit();
  for (const oid of oids) {
    if (!OID_PATTERN.test(oid)) failGit();
  }
  return oids;
}

// Splits the output of git show into hash, author name, author mail and the
// raw message. A further NUL byte means that the output has an unexpected
// shape and is a tool error.
function splitShowOutput(output, oid) {
  const parts = output.split('\0');
  if (parts.length !== 4) failGit();
  const [hash, name, email, rawMessage] = parts;
  if (hash !== oid) failGit();
  const message = rawMessage.endsWith('\n') ? rawMessage.slice(0, -1) : rawMessage;
  return { name, email, message };
}

// Git parses the trailers; this module only normalizes the result. Every
// line is split at its first colon, the value is trimmed.
function normalizeTrailers(output) {
  const trailers = [];
  for (const line of output.split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    if (key.length === 0) continue;
    trailers.push({ key, value });
  }
  return trailers;
}

// The trailer separators are pinned per process so that a local setting
// cannot change which lines Git reads as trailers.
function readTrailers(context, message) {
  const output = runGit(
    context,
    ['-c', 'trailer.separators=:', 'interpret-trailers', '--parse', '--no-divider'],
    message,
  );
  return normalizeTrailers(output);
}

// Reads author, message and trailers of one commit.
function readCommit(context, oid) {
  const output = runGit(context, [
    'show',
    '--no-patch',
    '--no-show-signature',
    '--encoding=UTF-8',
    '--format=%H%x00%an%x00%ae%x00%B',
    oid,
  ]);
  const { name, email, message } = splitShowOutput(output, oid);
  return { oid, author: { name, email }, message, trailers: readTrailers(context, message) };
}

// Reads every commit of the range BASE..TARGET from the repository in cwd.
// Returns the resolved object ids of both ends and the commit entries in
// reverse topological order.
export function readGitCommitRange(options = {}) {
  if (!isPlainObject(options)) failData();
  const workingDirectory = validateCwd(options.cwd);
  const { base: baseRef, target: targetRef } = parseRange(options.range);
  const context = {
    cwd: workingDirectory,
    env: buildEnv(),
    deadline: Date.now() + TOTAL_TIMEOUT_MS,
  };
  const base = resolveCommitOid(context, baseRef);
  const target = resolveCommitOid(context, targetRef);
  requireAncestor(context, base, target);
  const commits = listCommits(context, base, target).map((oid) => readCommit(context, oid));
  return { base, target, commits };
}

// Reads the worktree root and the current head commit of the repository in
// cwd. Returns exactly one absolute path line and the full object id of
// HEAD, nothing else.
export function readGitCheckout(options = {}) {
  if (!isPlainObject(options)) failData();
  const workingDirectory = validateCwd(options.cwd);
  const context = {
    cwd: workingDirectory,
    env: buildEnv(),
    deadline: Date.now() + TOTAL_TIMEOUT_MS,
  };
  const output = runGit(context, ['rev-parse', '--show-toplevel']);
  const lines = output.split('\n');
  if (lines.length !== 2 || lines[0].length === 0 || lines[1] !== '') failGit();
  if (CONTROL_CHARACTERS.test(lines[0])) failGit();
  if (!lines[0].startsWith('/')) failGit();
  const head = resolveCommitOid(context, 'HEAD');
  return { root: lines[0], head };
}
