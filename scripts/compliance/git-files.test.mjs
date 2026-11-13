// Tests for the git file snapshot reader.
//
// The fixtures are real temporary Git repositories that this file creates
// itself: no mock, no stub, no network and no read access to the surrounding
// repository. Every repository lives below a session specific prefix in the
// system temp directory and is removed again in the finally block of its test.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readGitFileSnapshot } from './git-files.mjs';

const SESSION_PREFIX = 'meetropolis-git-files-';
const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';
const GIT_ERROR_MESSAGE = 'git error: the git command failed, timed out or returned unusable data';
const MODULE_PATH = fileURLToPath(new URL('./git-files.mjs', import.meta.url));
const MISSING_OID = '1'.repeat(40);
// Child process that uses the real adapter. It reports the expected error
// only through its exit code, so that stdout and stderr stay free of text.
const PROBE_SOURCE = `
const { pathToFileURL } = await import('node:url');
const adapter = await import(pathToFileURL(process.env.PROBE_MODULE).href);
try {
  adapter.readGitFileSnapshot({ cwd: process.env.PROBE_REPO, commit: process.env.PROBE_COMMIT });
} catch (error) {
  process.exit(error.code === 'COMPLIANCE_GIT_ERROR' && error.message === process.env.PROBE_MESSAGE ? 0 : 3);
}
process.exit(4);
`;

let commitCounter = 0;

// Environment of the fixture repositories without any inherited GIT_*
// variable. The identity and the signing options stay inside the fixture.
function fixtureEnv(extra = {}) {
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase().startsWith('GIT_')) continue;
    const value = process.env[key];
    if (typeof value === 'string') env[key] = value;
  }
  return { ...env, ...extra };
}

// Git of the fixture repositories only.
function git(cwd, args, options = {}) {
  const { env, ...rest } = options;
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: fixtureEnv(env),
    ...rest,
  });
}

function createRepo() {
  const root = mkdtempSync(path.join(tmpdir(), SESSION_PREFIX));
  const repo = path.join(root, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Ada Example']);
  git(repo, ['config', 'user.email', 'ada@example.org']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  return { root, repo };
}

// Removes exactly the directory that this file created: the path has to sit
// below the temp root and has to carry the session prefix.
function removeRepo(fixture) {
  const resolved = path.resolve(fixture.root);
  const tempRoot = path.resolve(tmpdir());
  assert.ok(path.basename(resolved).startsWith(SESSION_PREFIX), 'refuse to remove a foreign directory');
  assert.ok(resolved.startsWith(`${tempRoot}${path.sep}`), 'refuse to remove a path outside the temp root');
  rmSync(resolved, { recursive: true, force: true });
}

function commitAll(repo, message) {
  commitCounter += 1;
  const stamp = `2020-01-01T00:00:${String(commitCounter).padStart(2, '0')}+0000`;
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message], {
    env: { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp },
  });
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

// Stores the given bytes as a blob and returns its object id.
function hashBytes(repo, bytes) {
  return git(repo, ['hash-object', '-w', '--stdin'], { input: bytes }).trim();
}

// Builds a tree from raw entries and commits it. Missing objects are
// allowed on purpose: the fixture needs entries that must never be read.
function commitTree(repo, lines, message) {
  const tree = git(repo, ['mktree', '--missing'], { input: `${lines.join('\n')}\n` }).trim();
  return git(repo, ['commit-tree', tree, '-p', 'HEAD', '-m', message]).trim();
}

function assertGitError(run) {
  assert.throws(run, (error) => {
    assert.equal(error.code, 'COMPLIANCE_GIT_ERROR');
    assert.equal(error.message, GIT_ERROR_MESSAGE);
    assert.equal(error.message.includes('Lard'), false);
    return true;
  });
}

function assertDataInvalid(run) {
  assert.throws(run, (error) => {
    assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
    assert.equal(error.message, DATA_INVALID_MESSAGE);
    return true;
  });
}

describe('readGitFileSnapshot: file contents', () => {
  it('reads every regular file byte by byte and sorts the result by path', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      const text = Buffer.from('Greetings from the office\n', 'utf8');
      const withNul = Buffer.from([0x61, 0x00, 0x62, 0xff, 0xfe]);
      const invalidUtf8 = Buffer.from([0xc3, 0x28, 0xa0, 0xa1]);
      writeFileSync(path.join(repo, 'empty.txt'), Buffer.alloc(0));
      writeFileSync(path.join(repo, 'text.txt'), text);
      writeFileSync(path.join(repo, 'nul.bin'), withNul);
      writeFileSync(path.join(repo, 'invalid.bin'), invalidUtf8);
      writeFileSync(path.join(repo, 'shared-a.txt'), 'same\n');
      writeFileSync(path.join(repo, 'shared-b.txt'), 'same\n');
      writeFileSync(path.join(repo, 'space ü name.txt'), 'unicode path\n');
      chmodSync(path.join(repo, 'text.txt'), 0o755);
      const commit = commitAll(repo, 'files');

      const snapshot = readGitFileSnapshot({ cwd: repo, commit });

      assert.equal(snapshot.commit, commit);
      assert.deepEqual([...snapshot.files.keys()], [...snapshot.files.keys()].sort());
      assert.deepEqual(snapshot.skipped, []);
      assert.equal(snapshot.files.get('text.txt').equals(text), true);
      assert.equal(snapshot.files.get('empty.txt').length, 0);
      assert.equal(snapshot.files.get('nul.bin').equals(withNul), true);
      assert.equal(snapshot.files.get('invalid.bin').equals(invalidUtf8), true);
      assert.equal(snapshot.files.get('shared-a.txt').equals(snapshot.files.get('shared-b.txt')), true);
      assert.equal(snapshot.files.has('space ü name.txt'), true);
      // The executable file keeps its mode in the tree and its bytes here.
      assert.equal(snapshot.files.get('text.txt').equals(text), true);
    } finally {
      removeRepo(fixture);
    }
  });

  it('reads the fixed commit and ignores a dirty worktree and index', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      writeFileSync(path.join(repo, 'file.txt'), 'first\n');
      const first = commitAll(repo, 'first');
      writeFileSync(path.join(repo, 'file.txt'), 'second\n');
      const second = commitAll(repo, 'second');
      writeFileSync(path.join(repo, 'file.txt'), 'dirty\n');
      git(repo, ['add', 'file.txt']);
      writeFileSync(path.join(repo, 'other.txt'), 'dirty too\n');

      const earlier = readGitFileSnapshot({ cwd: repo, commit: first });
      assert.equal(earlier.files.get('file.txt').toString('utf8'), 'first\n');
      assert.equal(earlier.files.has('other.txt'), false);

      const later = readGitFileSnapshot({ cwd: repo, commit: second });
      assert.equal(later.files.get('file.txt').toString('utf8'), 'second\n');
    } finally {
      removeRepo(fixture);
    }
  });
});

describe('readGitFileSnapshot: excluded paths', () => {
  it('skips symlinks and gitlinks without reading their objects', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      writeFileSync(path.join(repo, 'plain.txt'), 'plain\n');
      const base = commitAll(repo, 'base');
      symlinkSync('missing-target.txt', path.join(repo, 'link.txt'));
      git(repo, ['add', 'link.txt']);
      git(repo, ['update-index', '--add', '--cacheinfo', `160000,${base},submodule`]);
      // The commit keeps the index as it is: a further add would drop the
      // gitlink entry again.
      git(repo, ['commit', '-q', '-m', 'with special modes']);
      const commit = git(repo, ['rev-parse', 'HEAD']).trim();

      const snapshot = readGitFileSnapshot({ cwd: repo, commit });

      assert.deepEqual([...snapshot.files.keys()], ['plain.txt']);
      assert.deepEqual(snapshot.skipped, [
        { path: 'link.txt', code: 'GIT_MODE_UNSUPPORTED' },
        { path: 'submodule', code: 'GIT_MODE_UNSUPPORTED' },
      ]);
    } finally {
      removeRepo(fixture);
    }
  });

  it('never requests the objects of excluded env and special mode paths', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      writeFileSync(path.join(repo, 'plain.txt'), 'plain\n');
      commitAll(repo, 'base');
      const real = hashBytes(repo, Buffer.from('real\n', 'utf8'));
      // The excluded paths point at objects that do not exist at all.
      const lines = [
        `100644 blob ${real}\tplain.txt`,
        `100644 blob ${MISSING_OID}\t.env`,
        `100644 blob ${MISSING_OID}\t.env.example`,
        `120000 blob ${MISSING_OID}\tlink.txt`,
        `160000 commit ${MISSING_OID}\tsubmodule`,
      ];
      const commit = commitTree(repo, lines, 'with missing objects');

      const snapshot = readGitFileSnapshot({ cwd: repo, commit });

      assert.deepEqual([...snapshot.files.keys()], ['plain.txt']);
      assert.equal(snapshot.files.get('plain.txt').toString('utf8'), 'real\n');
      assert.deepEqual(snapshot.skipped, [
        { path: '.env', code: 'ENV_FILE_TRACKED' },
        { path: '.env.example', code: 'ENV_EXAMPLE_PENDING' },
        { path: 'link.txt', code: 'GIT_MODE_UNSUPPORTED' },
        { path: 'submodule', code: 'GIT_MODE_UNSUPPORTED' },
      ]);
    } finally {
      removeRepo(fixture);
    }
  });

  it('blocks real dotenv names and gates the examples behind the flag', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      const names = [
        '.env',
        '.env.local',
        'name.env',
        'name.env.local',
        '.env.example',
        '.env.production.example',
        'case/.ENV.EXAMPLE',
        '.envrc',
        'plain.txt',
      ];
      mkdirSync(path.join(repo, 'case'));
      for (const name of names) {
        writeFileSync(path.join(repo, name), 'PLACEHOLDER=1\n');
      }
      const commit = commitAll(repo, 'dotenv names');

      const blocked = readGitFileSnapshot({ cwd: repo, commit });
      assert.deepEqual([...blocked.files.keys()], ['.envrc', 'plain.txt']);
      assert.deepEqual(blocked.skipped, [
        { path: '.env', code: 'ENV_FILE_TRACKED' },
        { path: '.env.example', code: 'ENV_EXAMPLE_PENDING' },
        { path: '.env.local', code: 'ENV_FILE_TRACKED' },
        { path: '.env.production.example', code: 'ENV_EXAMPLE_PENDING' },
        { path: 'case/.ENV.EXAMPLE', code: 'ENV_FILE_TRACKED' },
        { path: 'name.env', code: 'ENV_FILE_TRACKED' },
        { path: 'name.env.local', code: 'ENV_FILE_TRACKED' },
      ]);

      const allowed = readGitFileSnapshot({ cwd: repo, commit, includeEnvExamples: true });
      assert.deepEqual([...allowed.files.keys()], ['.env.example', '.env.production.example', '.envrc', 'plain.txt']);
      assert.deepEqual(allowed.skipped, [
        { path: '.env', code: 'ENV_FILE_TRACKED' },
        { path: '.env.local', code: 'ENV_FILE_TRACKED' },
        { path: 'case/.ENV.EXAMPLE', code: 'ENV_FILE_TRACKED' },
        { path: 'name.env', code: 'ENV_FILE_TRACKED' },
        { path: 'name.env.local', code: 'ENV_FILE_TRACKED' },
      ]);
    } finally {
      removeRepo(fixture);
    }
  });
});

describe('readGitFileSnapshot: limits and errors', () => {
  it('fails when a blob, the path sum or the entry count exceeds the limit', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      writeFileSync(path.join(repo, 'plain.txt'), 'plain\n');
      commitAll(repo, 'base');

      const tooBig = hashBytes(repo, Buffer.alloc(16 * 1024 * 1024 + 1, 0x61));
      const bigCommit = commitTree(repo, [`100644 blob ${tooBig}\tbig.bin`], 'too big');
      assertGitError(() => readGitFileSnapshot({ cwd: repo, commit: bigCommit }));

      const shared = hashBytes(repo, Buffer.alloc(4 * 1024 * 1024, 0x61));
      const sumLines = [];
      for (let index = 0; index < 17; index += 1) sumLines.push(`100644 blob ${shared}\tfile-${index}.bin`);
      const sumCommit = commitTree(repo, sumLines, 'sum too big');
      assertGitError(() => readGitFileSnapshot({ cwd: repo, commit: sumCommit }));

      const small = hashBytes(repo, Buffer.from('x\n', 'utf8'));
      const manyLines = [];
      for (let index = 0; index < 20001; index += 1) manyLines.push(`100644 blob ${small}\tf${index}.txt`);
      const manyCommit = commitTree(repo, manyLines, 'too many entries');
      assertGitError(() => readGitFileSnapshot({ cwd: repo, commit: manyCommit }));
    } finally {
      removeRepo(fixture);
    }
  });

  it('fails for a wrong commit type, a missing object and invalid inputs', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      writeFileSync(path.join(repo, 'plain.txt'), 'plain\n');
      const commit = commitAll(repo, 'base');
      const tree = git(repo, ['rev-parse', `${commit}^{tree}`]).trim();

      assertGitError(() => readGitFileSnapshot({ cwd: repo, commit: tree }));
      assertGitError(() => readGitFileSnapshot({ cwd: repo, commit: MISSING_OID }));
      assertGitError(() => readGitFileSnapshot({ cwd: path.join(repo, 'missing'), commit }));

      const invalidCalls = [
        undefined,
        null,
        42,
        'x',
        [],
        {},
        { cwd: repo },
        { commit },
        { cwd: repo, commit: 'HEAD' },
        { cwd: repo, commit: 'abc' },
        { cwd: repo, commit: commit.toUpperCase() },
        { cwd: repo, commit: null },
        { cwd: repo, commit: 42 },
        { cwd: '', commit },
        { cwd: 'relative/path', commit },
        { cwd: '/tmp/with\nnewline', commit },
        { cwd: '/tmp/with\u0000nul', commit },
        { cwd: repo, commit, includeEnvExamples: 'true' },
        { cwd: repo, commit, includeEnvExamples: 1 },
        { cwd: repo, commit, includeEnvExamples: null },
      ];
      for (const options of invalidCalls) {
        assertDataInvalid(() => readGitFileSnapshot(options));
      }
    } finally {
      removeRepo(fixture);
    }
  });

  it('keeps raw git diagnostics out of the streams of the caller', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      writeFileSync(path.join(repo, 'plain.txt'), 'plain\n');
      commitAll(repo, 'base');

      const probe = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE_SOURCE], {
        env: {
          ...process.env,
          PROBE_MODULE: MODULE_PATH,
          PROBE_REPO: repo,
          PROBE_COMMIT: MISSING_OID,
          PROBE_MESSAGE: GIT_ERROR_MESSAGE,
        },
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      assert.equal(probe.status, 0, `probe exited with ${probe.status}`);
      assert.equal(probe.stdout, '');
      assert.equal(probe.stderr, '');
    } finally {
      removeRepo(fixture);
    }
  });
});
