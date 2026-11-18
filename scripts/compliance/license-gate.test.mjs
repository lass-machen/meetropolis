// Tests for the executable license gate CLI. Every case spawns the real
// CLI in a real temporary git fixture, without mocks, DI or stubs.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readGitFileSnapshot } from './git-files.mjs';
import { readGitCheckout } from './git-commits.mjs';
import { validateCheckResult } from '../license-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const CLI_FILENAME = 'license-gate.mjs';
const MARKER = 'P8EFIXTUREMARKER';
const BLOB_NAME = 'p8e-blob.bin';
const SESSION_PREFIX = 'meetropolis-license-gate-';
const EXPECTED_USAGE = 'Usage';

function fixtureEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  return env;
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: fixtureEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
  }).trim();
}

function guardedRemove(root) {
  const resolved = path.resolve(root);
  const tempRoot = path.resolve(os.tmpdir());
  assert.ok(path.basename(resolved).startsWith(SESSION_PREFIX));
  const relative = path.relative(tempRoot, resolved);
  assert.ok(relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative));
  fs.rmSync(resolved, { recursive: true, force: true });
}

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), SESSION_PREFIX));
  try {
    return buildFixtureInner(root);
  } catch (error) {
    try {
      guardedRemove(root);
    } catch {
      // Best effort only; the original error decides.
    }
    throw error;
  }
}

function buildFixtureInner(root) {
  const repo = path.join(root, 'gate');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'P8E Fixture']);
  git(repo, ['config', 'user.email', 'p8e-fixture@example.org']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  const head = readGitCheckout({ cwd: REPO_ROOT }).head;
  // The fixture carries the real example templates, so the gate has to review them.
  const snapshot = readGitFileSnapshot({ cwd: REPO_ROOT, commit: head, includeEnvExamples: true });
  for (const [filePath, bytes] of snapshot.files) {
    const target = path.join(repo, filePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  fs.copyFileSync(path.join(REPO_ROOT, 'scripts', CLI_FILENAME), path.join(repo, 'scripts', CLI_FILENAME));
  const parserTarget = path.join(repo, 'node_modules', '@babel', 'parser');
  fs.mkdirSync(path.dirname(parserTarget), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'node_modules', '@babel', 'parser'), parserTarget, { recursive: true });
  git(repo, ['add', '-A']);
  git(repo, [
    'commit',
    '-q',
    '-m',
    `fixture base ${MARKER}`,
    '-m',
    `Signed-off-by: P8E Fixture <p8e-fixture@example.org>`,
  ]);
  const base = git(repo, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(repo, BLOB_NAME), Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));
  // Changing the reviewed template after its approvals must turn the gate red.
  fs.appendFileSync(path.join(repo, '.env.example'), 'SEED_ADMIN_PASSWORD=fixture-only\n');
  git(repo, ['add', BLOB_NAME, '.env.example']);
  git(repo, [
    'commit',
    '-q',
    '-m',
    `fixture blob ${MARKER}`,
    '-m',
    `Signed-off-by: P8E Fixture <p8e-fixture@example.org>`,
  ]);
  git(repo, ['commit', '-q', '--allow-empty', '-m', `fixture unsigned ${MARKER}`]);
  const target = git(repo, ['rev-parse', 'HEAD']);
  return { root, repo, base, target };
}

function removeFixture(fixture) {
  guardedRemove(fixture.root);
}

function runCli(repo, args, options = {}) {
  const env = fixtureEnv();
  return spawnSync(process.execPath, [path.join(repo, 'scripts', CLI_FILENAME), ...args], {
    cwd: options.cwd ?? repo,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 100000,
  });
}

function readReport(reportPath) {
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

let fixture = null;

describe('validateCheckResult', () => {
  it('accepts a valid real result shape including an empty root', () => {
    assert.doesNotThrow(() =>
      validateCheckResult({
        records: [{ path: 'a.json' }],
        issues: [
          { severity: 'error', code: 'SOME_CODE', path: 'a/b.json', line: 3, column: 0 },
          { severity: 'warning', code: 'OTHER_CODE', root: '', line: 1 },
          {
            severity: 'info',
            code: 'THIRD_CODE',
            lockPath: 'pkg',
            commit: 'b1e42dca212355b65de7f697bc9eeff9859babac',
          },
        ],
      }),
    );
  });

  it('rejects misshapen results with the constant data error', () => {
    for (const result of [
      undefined,
      null,
      42,
      'x',
      [],
      { records: 'x', issues: [] },
      { records: [] },
      { issues: [] },
    ]) {
      assert.throws(
        () => validateCheckResult(result),
        (error) => {
          assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
          return true;
        },
      );
    }
  });

  it('rejects unknown severities without leaking markers', () => {
    const marker = 'P8EMARKERINVALID';
    try {
      validateCheckResult({ records: [], issues: [{ severity: 'bogus', code: 'X', path: marker }] });
      assert.fail('expected an error');
    } catch (error) {
      assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
      assert.ok(!error.message.includes(marker));
      assert.ok(!String(error.code).includes(marker));
      assert.equal(error.cause, undefined);
    }
  });

  it('rejects invalid codes, paths, commits and positions', () => {
    const bad = [
      { severity: 'error', code: '', path: 'a.json' },
      { severity: 'error', code: 'lower-case', path: 'a.json' },
      { severity: 'error', code: 'WITH SPACE', path: 'a.json' },
      { severity: 'error', code: 'X', path: '' },
      { severity: 'error', code: 'X', path: '/absolute.json' },
      { severity: 'error', code: 'X', path: 'C:/win.json' },
      { severity: 'error', code: 'X', path: 'a\\b.json' },
      { severity: 'error', code: 'X', path: 'C:relative.json' },
      { severity: 'error', code: 'X', root: 'C:relative' },
      { severity: 'error', code: 'X', lockPath: 'C:relative' },
      { severity: 'error', code: 'X', path: 'a\u2028b.json' },
      { severity: 'error', code: 'X', path: 'a\u2029b.json' },
      { severity: 'error', code: 'X', path: 'a\x85b.json' },
      { severity: 'error', code: 'X', path: 'a/./b.json' },
      { severity: 'error', code: 'X', path: 'a/../b.json' },
      { severity: 'error', code: 'X', path: 'a//b.json' },
      { severity: 'error', code: 'X', root: '/absolute' },
      { severity: 'error', code: 'X', lockPath: 'a\\b' },
      { severity: 'error', code: 'X', path: 'a.json', commit: 'abc123' },
      { severity: 'error', code: 'X', path: 'a.json', commit: 'B1E42DCA212355B65DE7F697BC9EEFF9859BABAC' },
      { severity: 'error', code: 'X', path: 'a.json', line: 0 },
      { severity: 'error', code: 'X', path: 'a.json', line: -2 },
      { severity: 'error', code: 'X', path: 'a.json', line: 1.5 },
      { severity: 'error', code: 'X', path: 'a.json', column: -1 },
      { severity: 'error', code: 'X', path: 'a.json', column: 0.5 },
      'not-an-object',
    ];
    for (const issue of bad) {
      assert.throws(
        () => validateCheckResult({ records: [], issues: [issue] }),
        (error) => error.code === 'COMPLIANCE_DATA_INVALID',
        `expected rejection for ${JSON.stringify(issue)}`,
      );
    }
  });
});

describe('license gate CLI', () => {
  before(() => {
    fixture = buildFixture();
  });

  after(() => {
    if (fixture !== null) removeFixture(fixture);
  });

  it('exits 1 with a real asset finding for all with the head commit', () => {
    const reportPath = path.join(fixture.repo, 'out-a.json');
    const child = runCli(fixture.repo, ['--all', '--commit', fixture.target, '--json', reportPath]);
    assert.equal(child.status, 1);
    const report = readReport(reportPath);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.mode, 'all');
    assert.equal(report.base, null);
    assert.equal(report.target, fixture.target);
    assert.equal(report.exitCode, 1);
    assert.deepEqual(
      report.checks.map((check) => check.name),
      ['snapshot', 'dependencies', 'assets', 'metadata', 'documentation', 'sourceBoundaries', 'envExamples', 'dco'],
    );
    const snapshotCheck = report.checks.find((check) => check.name === 'snapshot');
    assert.equal(snapshotCheck.issueCount, 0);
    assert.ok(!report.issues.some((issue) => issue.code === 'ENV_EXAMPLE_PENDING'));
    const envIssues = report.issues.filter((issue) => issue.check === 'envExamples');
    assert.ok(envIssues.some((issue) => issue.severity === 'error' && issue.path === '.env.example'));
    assert.ok(envIssues.some((issue) => issue.code === 'ENV_EXAMPLE_REVIEW_STALE'));
    assert.ok(envIssues.some((issue) => issue.code === 'ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED'));
    for (const issue of envIssues) {
      assert.ok(Number.isInteger(issue.line) && issue.line >= 1);
    }
    const dco = report.checks.find((check) => check.name === 'dco');
    assert.equal(dco.status, 'not_requested');
    assert.equal(dco.recordCount, 0);
    assert.equal(dco.issueCount, 0);
    const blobIssues = report.issues.filter((issue) => issue.path === BLOB_NAME);
    assert.ok(blobIssues.length > 0);
    assert.ok(child.stdout.includes(fixture.target));
    assert.ok(child.stdout.includes('error'));
    assert.ok(!child.stdout.includes(MARKER));
    assert.ok(!JSON.stringify(report).includes(MARKER));
  });

  it('produces byte-identical json on a repeated run', () => {
    const first = path.join(fixture.repo, 'out-b1.json');
    const second = path.join(fixture.repo, 'out-b2.json');
    const one = runCli(fixture.repo, ['--all', '--commit', fixture.target, '--json', first]);
    const two = runCli(fixture.repo, ['--all', '--commit', fixture.target, '--json', second]);
    assert.equal(one.status, 1);
    assert.equal(two.status, 1);
    assert.equal(fs.readFileSync(first, 'utf8'), fs.readFileSync(second, 'utf8'));
  });

  it('reports the missing signoff and the blob finding for a range', () => {
    const reportPath = path.join(fixture.repo, 'out-c.json');
    const child = runCli(fixture.repo, ['--range', `${fixture.base}..${fixture.target}`, '--json', reportPath]);
    assert.equal(child.status, 1);
    const report = readReport(reportPath);
    assert.equal(report.mode, 'range');
    assert.equal(report.base, fixture.base);
    assert.equal(report.target, fixture.target);
    const dco = report.checks.find((check) => check.name === 'dco');
    assert.ok(dco.recordCount > 0);
    assert.ok(report.issues.some((issue) => issue.code === 'COMMIT_SIGNOFF_MISSING'));
    assert.ok(report.issues.some((issue) => issue.path === BLOB_NAME));
    assert.ok(!JSON.stringify(report).includes(MARKER));
  });

  it('rejects invalid arguments with the constant exit code', () => {
    for (const args of [[], ['--bogus'], ['--range'], ['--all', '--range', 'a..b']]) {
      const child = runCli(fixture.repo, args);
      assert.equal(child.status, 2);
      assert.equal(child.stdout, '');
      assert.ok(child.stderr.includes(EXPECTED_USAGE));
      assert.ok(!child.stderr.includes('--bogus'));
    }
  });

  it('rejects a valid but foreign commit before the snapshot', () => {
    const other = runCli(fixture.repo, ['--all', '--commit', fixture.base]);
    assert.equal(other.status, 2);
    assert.equal(other.stdout, '');
    const range = runCli(fixture.repo, ['--range', `${fixture.base}..${fixture.base}`]);
    assert.equal(range.status, 2);
    assert.equal(range.stdout, '');
  });

  it('rejects a foreign checkout for the copied cli', () => {
    const foreign = fs.mkdtempSync(path.join(os.tmpdir(), `${SESSION_PREFIX}foreign-`));
    try {
      const repo = path.join(foreign, 'other');
      fs.mkdirSync(repo, { recursive: true });
      git(repo, ['init', '-q', '-b', 'main']);
      git(repo, ['config', 'user.name', 'Other']);
      git(repo, ['config', 'user.email', 'other@example.org']);
      git(repo, ['config', 'commit.gpgsign', 'false']);
      fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', 'other']);
      const child = runCli(fixture.repo, ['--all'], { cwd: repo });
      assert.equal(child.status, 2);
      assert.equal(child.stdout, '');
    } finally {
      removeFixture({ root: foreign });
    }
  });

  it('reports a missing own install without leaking internals', () => {
    const parserDir = path.join(fixture.repo, 'node_modules', '@babel', 'parser');
    const hidden = path.join(fixture.repo, 'node_modules', '@babel', 'parser-hidden');
    fs.renameSync(parserDir, hidden);
    try {
      const child = runCli(fixture.repo, ['--all']);
      assert.equal(child.status, 2);
      assert.equal(child.stdout, '');
      assert.ok(child.stderr.includes('npm ci'));
      assert.ok(!child.stderr.includes(hidden));
      assert.ok(!child.stderr.includes('node_modules'));
    } finally {
      fs.renameSync(hidden, parserDir);
    }
  });

  it('allows a subdirectory of the own checkout', () => {
    const sub = path.join(fixture.repo, 'compliance');
    fs.mkdirSync(sub, { recursive: true });
    const child = runCli(fixture.repo, ['--all', '--commit', fixture.target], { cwd: sub });
    assert.equal(child.status, 1);
  });

  it('rejects an unwritable json target without leaking the path', () => {
    const dir = path.join(fixture.repo, 'out-dir');
    fs.mkdirSync(dir, { recursive: true });
    const child = runCli(fixture.repo, ['--all', '--commit', fixture.target, '--json', dir]);
    assert.equal(child.status, 2);
    assert.equal(child.stdout, '');
    assert.ok(!child.stderr.includes(dir));
    assert.ok(!child.stderr.includes('EISDIR'));
  });
});
