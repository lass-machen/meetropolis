// Executable license gate: range or all mode over one repository checkout.
//
// Reads the checkout root and head, binds execution to the own checkout,
// resolves the target commit, scans the file snapshot with the existing
// compliance checkers and prints a deterministic report. Pure readers only:
// no shell, no network; the target source is only the git snapshot, while
// the loader explicitly reads the own install, manifest and lock metadata
// from the checkout.

import { realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCommitSignoffs } from './compliance/commits.mjs';
import { readGitCheckout, readGitCommitRange } from './compliance/git-commits.mjs';
import { readGitFileSnapshot } from './compliance/git-files.mjs';
import { parseLicenseGateArgs } from './compliance/cli-options.mjs';
import { checkDependencies } from './compliance/dependencies.mjs';
import { checkAssets } from './compliance/assets.mjs';
import { checkMetadata } from './compliance/metadata.mjs';
import { checkDocumentation } from './compliance/documentation.mjs';
import { checkSourceBoundaries } from './compliance/source-boundaries.mjs';
import { loadSourceParser } from './compliance/parser-runtime.mjs';

const CHECKOUT_MISMATCH_CODE = 'COMPLIANCE_CHECKOUT_MISMATCH';
const CHECKOUT_MISMATCH_MESSAGE = 'The gate checkout does not match the working directory.';
const TARGET_MISMATCH_CODE = 'COMPLIANCE_TARGET_MISMATCH';
const TARGET_MISMATCH_MESSAGE = 'The target commit does not match HEAD.';
const WRITE_FAILED_CODE = 'COMPLIANCE_REPORT_WRITE_FAILED';
const WRITE_FAILED_MESSAGE = 'The report could not be written.';
const INTERNAL_CODE = 'COMPLIANCE_INTERNAL_ERROR';
const INTERNAL_MESSAGE = 'An internal error occurred.';

const KNOWN_MESSAGES = {
  COMPLIANCE_GIT_ERROR: 'The git query failed.',
  COMPLIANCE_DATA_INVALID: 'The compliance data is invalid.',
  LOCKFILE_INVALID: 'A lockfile is invalid.',
  COMPLIANCE_CHECKOUT_MISMATCH: CHECKOUT_MISMATCH_MESSAGE,
  COMPLIANCE_TARGET_MISMATCH: TARGET_MISMATCH_MESSAGE,
  COMPLIANCE_REPORT_WRITE_FAILED: WRITE_FAILED_MESSAGE,
  COMPLIANCE_ARGUMENTS_INVALID:
    'Invalid arguments. Usage: --range BASE..TARGET [--json PATH] or --all [--commit SHA] [--json PATH].',
  COMPLIANCE_PARSER_UNAVAILABLE:
    'The source parser is not available. Run "npm ci" in the gate checkout and repeat the check.',
};

const ISSUE_CODE_PATTERN = /^[A-Z0-9_]+$/;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failData() {
  const error = new Error('The compliance data is invalid.');
  error.code = 'COMPLIANCE_DATA_INVALID';
  error.exitCode = 2;
  throw error;
}

function isRepoPath(value, allowEmpty) {
  if (typeof value !== 'string') return false;
  if (value.length === 0) return allowEmpty;
  if (value.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  if (value.includes('\\')) return false;
  if (CONTROL_CHARACTERS.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

// Validates one checker result before any use: exact record and issue
// arrays, strict severities and codes, strictly typed location fields.
// Unknown extra fields are never echoed; invalid input fails closed.
export function validateCheckResult(result) {
  if (!isPlainObject(result)) failData();
  if (!Array.isArray(result.records) || !Array.isArray(result.issues)) failData();
  for (const issue of result.issues) {
    if (!isPlainObject(issue)) failData();
    if (issue.severity !== 'error' && issue.severity !== 'warning' && issue.severity !== 'info') failData();
    if (typeof issue.code !== 'string' || issue.code.length === 0 || !ISSUE_CODE_PATTERN.test(issue.code)) {
      failData();
    }
    if (issue.path !== undefined && !isRepoPath(issue.path, false)) failData();
    if (issue.root !== undefined && !isRepoPath(issue.root, true)) failData();
    if (issue.lockPath !== undefined && !isRepoPath(issue.lockPath, true)) failData();
    if (issue.commit !== undefined && (typeof issue.commit !== 'string' || !COMMIT_PATTERN.test(issue.commit))) {
      failData();
    }
    if (
      issue.line !== undefined &&
      (typeof issue.line !== 'number' || !Number.isInteger(issue.line) || issue.line <= 0)
    ) {
      failData();
    }
    if (
      issue.column !== undefined &&
      (typeof issue.column !== 'number' || !Number.isInteger(issue.column) || issue.column < 0)
    ) {
      failData();
    }
  }
}

function failCheckout() {
  const error = new Error(CHECKOUT_MISMATCH_MESSAGE);
  error.code = CHECKOUT_MISMATCH_CODE;
  error.exitCode = 2;
  throw error;
}

function failTarget() {
  const error = new Error(TARGET_MISMATCH_MESSAGE);
  error.code = TARGET_MISMATCH_CODE;
  error.exitCode = 2;
  throw error;
}

function failWrite() {
  const error = new Error(WRITE_FAILED_MESSAGE);
  error.code = WRITE_FAILED_CODE;
  error.exitCode = 2;
  throw error;
}

function publicIssue(check, issue) {
  const out = { check, severity: issue.severity, code: issue.code };
  for (const key of ['path', 'root', 'lockPath', 'commit', 'line', 'column']) {
    if (issue[key] !== undefined) out[key] = issue[key];
  }
  return out;
}

function compareIssues(left, right) {
  if (left.check !== right.check) return left.check < right.check ? -1 : 1;
  if (left.code !== right.code) return left.code < right.code ? -1 : 1;
  for (const key of ['path', 'root', 'lockPath', 'commit']) {
    const a = left[key] ?? '';
    const b = right[key] ?? '';
    if (a !== b) return a < b ? -1 : 1;
  }
  for (const key of ['line', 'column']) {
    const a = left[key] ?? -1;
    const b = right[key] ?? -1;
    if (a !== b) return a - b;
  }
  return 0;
}

function locationOf(issue) {
  const parts = [];
  if (issue.path !== undefined) parts.push(issue.path);
  else if (issue.root !== undefined) parts.push(issue.root);
  else if (issue.lockPath !== undefined) parts.push(issue.lockPath);
  else if (issue.commit !== undefined) parts.push(issue.commit);
  if (issue.line !== undefined) parts.push(String(issue.line));
  return parts.join(':');
}

function checkEntry(name, records, issues) {
  return {
    name,
    status: issues.some((issue) => issue.severity === 'error') ? 'fail' : 'pass',
    recordCount: records.length,
    issueCount: issues.length,
  };
}

function main() {
  const options = parseLicenseGateArgs(process.argv.slice(2));
  const checkout = readGitCheckout({ cwd: process.cwd() });
  const gateRoot = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  if (realpathSync(checkout.root) !== gateRoot) failCheckout();

  let base = null;
  let target = checkout.head;
  let commits = [];
  if (options.mode === 'all') {
    if (options.commit !== null && options.commit !== checkout.head) failTarget();
    target = checkout.head;
  } else {
    const range = readGitCommitRange({ cwd: checkout.root, range: options.range });
    base = range.base;
    target = range.target;
    commits = range.commits;
    if (target !== checkout.head) failTarget();
  }

  // The parser of the own checkout has to load before any finding, so a
  // missing installation can never report green on an empty snapshot.
  loadSourceParser();

  const snapshot = readGitFileSnapshot({ cwd: checkout.root, commit: target, includeEnvExamples: false });
  const files = snapshot.files;

  const collected = [];
  const dependencies = checkDependencies({ files });
  validateCheckResult(dependencies);
  collected.push({ name: 'dependencies', ...dependencies });
  const assets = checkAssets({ files });
  validateCheckResult(assets);
  collected.push({ name: 'assets', ...assets });
  const metadata = checkMetadata({ files });
  validateCheckResult(metadata);
  collected.push({ name: 'metadata', ...metadata });
  const documentation = checkDocumentation({ files });
  validateCheckResult(documentation);
  collected.push({ name: 'documentation', ...documentation });
  const boundaries = checkSourceBoundaries({ files });
  validateCheckResult(boundaries);
  collected.push({ name: 'sourceBoundaries', ...boundaries });

  let dco;
  if (options.mode === 'all') {
    dco = { name: 'dco', status: 'not_requested', records: [], issues: [] };
  } else {
    const result = checkCommitSignoffs({ commits });
    validateCheckResult(result);
    dco = { name: 'dco', ...result };
  }

  const skippedIssues = snapshot.skipped.map((entry) => ({ severity: 'error', code: entry.code, path: entry.path }));
  validateCheckResult({ records: [], issues: skippedIssues });
  const issues = [];
  for (const entry of snapshot.skipped) {
    issues.push({ check: 'snapshot', severity: 'error', code: entry.code, path: entry.path });
  }
  for (const entry of collected) {
    for (const issue of entry.issues) issues.push(publicIssue(entry.name, issue));
  }
  for (const issue of dco.issues) issues.push(publicIssue('dco', issue));
  validateCheckResult({ records: [], issues });
  issues.sort(compareIssues);

  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) {
    counts[issue.severity] += 1;
  }
  const exitCode = counts.error > 0 ? 1 : 0;

  const checks = [
    {
      name: 'snapshot',
      status: snapshot.skipped.length > 0 ? 'fail' : 'pass',
      recordCount: files.size,
      issueCount: snapshot.skipped.length,
    },
    ...collected.map((entry) => checkEntry(entry.name, entry.records, entry.issues)),
    {
      name: 'dco',
      status: dco.status ?? (dco.issues.some((issue) => issue.severity === 'error') ? 'fail' : 'pass'),
      recordCount: dco.records.length,
      issueCount: dco.issues.length,
    },
  ];
  const report = {
    schemaVersion: 1,
    mode: options.mode,
    base,
    target,
    exitCode,
    counts,
    checks,
    issues,
  };

  if (options.jsonPath !== null) {
    try {
      writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    } catch {
      failWrite();
    }
  }
  const summary = `License-Gate ${options.mode}: target ${target}, ${counts.error} errors, ${counts.warning} warnings, ${counts.info} notes.`;
  const lines = [summary];
  for (const issue of issues) {
    if (issue.severity !== 'error') continue;
    const location = locationOf(issue);
    lines.push(`  ${issue.severity} ${issue.code}${location === '' ? '' : ` ${location}`}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = exitCode;
}

function isDirectlyInvoked() {
  try {
    const invoked = process.argv[1];
    if (typeof invoked !== 'string' || invoked.length === 0) return false;
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectlyInvoked()) {
  try {
    main();
  } catch (error) {
    const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : null;
    if (code !== null && Object.hasOwn(KNOWN_MESSAGES, code)) {
      process.stderr.write(`${KNOWN_MESSAGES[code]} [${code}]\n`);
    } else {
      process.stderr.write(`${INTERNAL_MESSAGE} [${INTERNAL_CODE}]\n`);
    }
    process.exitCode = 2;
  }
}
