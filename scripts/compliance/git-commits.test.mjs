// Tests for the git commit range reader.
//
// The fixtures are real temporary Git repositories that this file creates
// itself: no mock, no stub, no network and no read access to the surrounding
// repository. Every repository lives below a session specific prefix in the
// system temp directory and is removed again in the finally block of its test.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readGitCheckout, readGitCommitRange } from './git-commits.mjs';
import { checkCommitSignoffs } from './commits.mjs';

const SESSION_PREFIX = 'meetropolis-git-commits-';
const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';
const GIT_ERROR_MESSAGE = 'git error: the git command failed, timed out or returned unusable data';
const OID_PATTERN = /^[0-9a-f]{40}$/;
const MODULE_PATH = fileURLToPath(new URL('./git-commits.mjs', import.meta.url));
const MARKER_TAG = 'Lard-Marker';
// Child process that uses the real adapter in a real repository. It reports
// the expected error only through its exit code, so that stdout and stderr
// stay free of any text of its own.
const PROBE_SOURCE = `
const { pathToFileURL } = await import('node:url');
const adapter = await import(pathToFileURL(process.env.PROBE_MODULE).href);
try {
  adapter.readGitCommitRange({ cwd: process.env.PROBE_REPO, range: process.env.PROBE_RANGE });
} catch (error) {
  process.exit(error.code === 'COMPLIANCE_GIT_ERROR' && error.message === process.env.PROBE_MESSAGE ? 0 : 3);
}
process.exit(4);
`;

let commitCounter = 0;

// Git of the fixture repositories only. The identity and the signing options
// stay inside the fixture; the surrounding repository is never touched.
function git(cwd, args, options = {}) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    ...options,
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

// Writes a file, commits it and returns the object id of the new commit.
function commitFile(repo, filename, content, message, author) {
  commitCounter += 1;
  writeFileSync(path.join(repo, filename), content);
  git(repo, ['add', filename]);
  const stamp = `2020-01-01T00:00:${String(commitCounter).padStart(2, '0')}+0000`;
  const env = { ...process.env, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp };
  const args = ['commit', '-q', '-F', '-'];
  if (author !== undefined) args.push(`--author=${author}`);
  git(repo, args, { env, input: message });
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function assertGitError(run) {
  assert.throws(run, (error) => {
    assert.equal(error.code, 'COMPLIANCE_GIT_ERROR');
    assert.equal(error.message, GIT_ERROR_MESSAGE);
    assert.equal(error.message.includes('Lard'), false);
    return true;
  });
}

function assertDataInvalid(run, marker) {
  assert.throws(run, (error) => {
    assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
    assert.equal(error.message, DATA_INVALID_MESSAGE);
    if (marker !== undefined) assert.equal(error.message.includes(marker), false);
    return true;
  });
}

describe('readGitCommitRange: sign-off trailers', () => {
  it('reads the real trailers and reports missing, foreign and matching sign-offs', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      const start = commitFile(repo, 'start.txt', 'start\n', 'Start commit\n');
      const plain = commitFile(repo, 'a.txt', 'a\n', 'Initial commit\n');
      const bodyOnly = commitFile(
        repo,
        'b.txt',
        'b\n',
        'Body sign-off only\n\nSigned-off-by: Body Person <body@example.org>\n\nTrailing prose.\n',
      );
      const unsigned = commitFile(repo, 'c.txt', 'c\n', 'Unsigned change\n');
      const matching = commitFile(
        repo,
        'd.txt',
        'd\n',
        'Matching sign-off\n\nSigned-off-by: Ada Example <ada@example.org>\n',
      );
      const foreign = commitFile(
        repo,
        'e.txt',
        'e\n',
        'Foreign sign-off\n\nSigned-off-by: Foreign Person <foreign@example.org>\n',
      );
      const folded = commitFile(
        repo,
        'f.txt',
        'f\n',
        'Folded sign-off\n\nSigned-off-by: Ada Example\n <ada@example.org>\n',
      );
      const umlaut = commitFile(
        repo,
        'g.txt',
        'g\n',
        'Umlaut sign-off\n\nSigned-off-by: Jürgen Müller <juergen.mueller@example.org>\n',
        'Jürgen Müller <juergen.mueller@example.org>',
      );
      const colon = commitFile(
        repo,
        'h.txt',
        'h\n',
        'Colon in a trailer value\n\nReviewed-by: X: Y <x@example.org>\nSigned-off-by: Ada Example <ada@example.org>\n',
      );
      const divider = commitFile(
        repo,
        'i.txt',
        'i\n',
        'Divider line\n\n---\n\nSigned-off-by: Ada Example <ada@example.org>\n',
      );

      const read = readGitCommitRange({ cwd: repo, range: `${start}..HEAD` });
      assert.equal(read.commits.length, 9);

      const byOid = new Map(read.commits.map((entry) => [entry.oid, entry]));
      assert.deepEqual(
        [...byOid.keys()].sort(),
        [plain, bodyOnly, unsigned, matching, foreign, folded, umlaut, colon, divider].sort(),
      );

      // The body line is no final trailer, so the commit stays unsigned.
      assert.deepEqual(byOid.get(bodyOnly).trailers, []);
      assert.deepEqual(byOid.get(unsigned).trailers, []);
      assert.deepEqual(byOid.get(matching).trailers, [
        { key: 'Signed-off-by', value: 'Ada Example <ada@example.org>' },
      ]);
      assert.deepEqual(byOid.get(folded).trailers, [{ key: 'Signed-off-by', value: 'Ada Example <ada@example.org>' }]);
      assert.deepEqual(byOid.get(umlaut).trailers, [
        { key: 'Signed-off-by', value: 'Jürgen Müller <juergen.mueller@example.org>' },
      ]);
      assert.deepEqual(byOid.get(colon).trailers, [
        { key: 'Reviewed-by', value: 'X: Y <x@example.org>' },
        { key: 'Signed-off-by', value: 'Ada Example <ada@example.org>' },
      ]);
      // The divider line does not stop the trailer block behind it.
      assert.deepEqual(byOid.get(divider).trailers, [{ key: 'Signed-off-by', value: 'Ada Example <ada@example.org>' }]);

      const checked = checkCommitSignoffs({ commits: read.commits });
      const codes = new Map(checked.issues.map((issue) => [issue.commit, issue.code]));
      assert.equal(codes.get(plain), 'COMMIT_SIGNOFF_MISSING');
      assert.equal(codes.get(bodyOnly), 'COMMIT_SIGNOFF_MISSING');
      assert.equal(codes.get(unsigned), 'COMMIT_SIGNOFF_MISSING');
      assert.equal(codes.get(foreign), 'COMMIT_SIGNOFF_AUTHOR_MISMATCH');
      assert.equal(codes.get(matching), undefined);
      assert.equal(codes.get(folded), undefined);
      assert.equal(codes.get(umlaut), undefined);
      assert.equal(codes.get(colon), undefined);
      assert.equal(codes.get(divider), undefined);
    } finally {
      removeRepo(fixture);
    }
  });

  it('exposes exactly the documented entry shape', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      const base = commitFile(repo, 'a.txt', 'a\n', 'Base\n');
      commitFile(repo, 'b.txt', 'b\n', 'Change\n\nSigned-off-by: Ada Example <ada@example.org>\n');
      const read = readGitCommitRange({ cwd: repo, range: `${base}..HEAD` });
      assert.equal(read.commits.length, 1);
      const entry = read.commits[0];
      assert.deepEqual(Object.keys(entry).sort(), ['author', 'message', 'oid', 'trailers']);
      assert.deepEqual(Object.keys(entry.author).sort(), ['email', 'name']);
      assert.equal(entry.oid, git(repo, ['rev-parse', 'HEAD']).trim());
      assert.equal(entry.message, 'Change\n\nSigned-off-by: Ada Example <ada@example.org>\n');
      assert.match(read.base, OID_PATTERN);
      assert.match(read.target, OID_PATTERN);
    } finally {
      removeRepo(fixture);
    }
  });
});

describe('readGitCommitRange: range semantics', () => {
  it('excludes the base and lists every new commit including the merge branches', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      const base = commitFile(repo, 'base.txt', 'base\n', 'Base commit\n');
      git(repo, ['checkout', '-q', '-b', 'side']);
      const side = commitFile(repo, 'side.txt', 'side\n', 'Side commit\n');
      git(repo, ['checkout', '-q', 'main']);
      const main = commitFile(repo, 'main.txt', 'main\n', 'Main commit\n');
      git(repo, ['merge', '-q', '--no-ff', 'side', '-m', 'Merge branch side\n']);
      const merge = git(repo, ['rev-parse', 'HEAD']).trim();

      const read = readGitCommitRange({ cwd: repo, range: `${base}..HEAD` });
      const oids = read.commits.map((entry) => entry.oid);
      assert.equal(oids.length, 3);
      assert.deepEqual([...oids].sort(), [main, side, merge].sort());
      assert.equal(oids.includes(base), false);
      assert.equal(read.base, base);
      assert.equal(read.target, merge);
    } finally {
      removeRepo(fixture);
    }
  });

  it('accepts an identical range and resolves both ends to full object ids', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      const head = commitFile(repo, 'a.txt', 'a\n', 'Only commit\n');
      const read = readGitCommitRange({ cwd: repo, range: 'HEAD..HEAD' });
      assert.deepEqual(read.commits, []);
      assert.equal(read.base, head);
      assert.equal(read.target, head);
      assert.match(read.base, OID_PATTERN);
      assert.match(read.target, OID_PATTERN);
    } finally {
      removeRepo(fixture);
    }
  });

  it('reads a detached head and leaves a dirty working tree untouched', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      commitFile(repo, 'a.txt', 'a\n', 'First\n');
      commitFile(repo, 'b.txt', 'b\n', 'Second\n');
      commitFile(repo, 'c.txt', 'c\n', 'Third\n');
      git(repo, ['checkout', '-q', '--detach', 'HEAD']);

      const read = readGitCommitRange({ cwd: repo, range: 'HEAD~2..HEAD' });
      assert.equal(read.commits.length, 2);

      writeFileSync(path.join(repo, 'a.txt'), 'dirty content\n');
      const statusBefore = git(repo, ['status', '--porcelain']);
      const contentBefore = readFileSync(path.join(repo, 'a.txt'), 'utf8');
      const dirtyRead = readGitCommitRange({ cwd: repo, range: 'HEAD~2..HEAD' });
      assert.equal(dirtyRead.commits.length, 2);
      assert.equal(readFileSync(path.join(repo, 'a.txt'), 'utf8'), contentBefore);
      assert.equal(git(repo, ['status', '--porcelain']), statusBefore);
    } finally {
      removeRepo(fixture);
    }
  });
});

describe('readGitCommitRange: error handling', () => {
  it('reports a constant git error for a missing ref, a wrong object type and a missing ancestor', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      commitFile(repo, 'a.txt', 'a\n', 'Base\n');
      git(repo, ['checkout', '-q', '-b', 'side']);
      commitFile(repo, 'side.txt', 'side\n', 'Side\n');
      git(repo, ['checkout', '-q', 'main']);
      commitFile(repo, 'main.txt', 'main\n', 'Main\n');
      const blob = git(repo, ['hash-object', '-w', '--stdin'], { input: 'blob content\n' }).trim();
      git(repo, ['tag', 'blobtag', blob]);

      assertGitError(() => readGitCommitRange({ cwd: repo, range: 'does-not-exist..HEAD' }));
      assertGitError(() => readGitCommitRange({ cwd: repo, range: 'blobtag..HEAD' }));
      assertGitError(() => readGitCommitRange({ cwd: repo, range: 'side..main' }));
      assertGitError(() => readGitCommitRange({ cwd: repo, range: 'HEAD..does-not-exist' }));
      assertGitError(() => readGitCommitRange({ cwd: path.join(repo, 'missing-directory'), range: 'HEAD..HEAD' }));
    } finally {
      removeRepo(fixture);
    }
  });

  it('rejects malformed inputs with a constant data error', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      commitFile(repo, 'a.txt', 'a\n', 'Base\n');

      const invalidRanges = [
        'HEAD',
        '',
        'HEAD..',
        '..HEAD',
        '...',
        'HEAD...HEAD',
        'HEAD....HEAD',
        'HEAD..HEAD..HEAD',
        '--upload-pack=evil',
        '-HEAD..HEAD',
        'HEAD;rm..HEAD',
        '$(id)..HEAD',
        '`id`..HEAD',
        'HEAD@{0}..HEAD',
        ':/src..HEAD',
        'HEAD HEAD..HEAD',
        'HEAD\t..HEAD',
        'HEAD..HEAD\n',
        'HEAD..HEAD ',
        'HEAD..HEAD;',
      ];
      for (const range of invalidRanges) {
        assertDataInvalid(() => readGitCommitRange({ cwd: repo, range }), 'evil');
      }

      const invalidCalls = [
        undefined,
        null,
        42,
        'HEAD..HEAD',
        [],
        {},
        { cwd: repo },
        { range: 'HEAD..HEAD' },
        { cwd: repo, range: null },
        { cwd: repo, range: 42 },
        { cwd: '', range: 'HEAD..HEAD' },
        { cwd: 'relative/path', range: 'HEAD..HEAD' },
        { cwd: 'relative/path', range: 'HEAD..HEAD' },
        { cwd: '/tmp/with\nnewline', range: 'HEAD..HEAD' },
        { cwd: '/tmp/with\u0000nul', range: 'HEAD..HEAD' },
      ];
      for (const options of invalidCalls) {
        assertDataInvalid(() => readGitCommitRange(options));
      }
    } finally {
      removeRepo(fixture);
    }
  });
});

describe('readGitCommitRange: process environment', () => {
  it('overrides a local trailer.separators setting per process and keeps the config unchanged', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      git(repo, ['config', 'trailer.separators', ';']);
      const start = commitFile(repo, 'start.txt', 'start\n', 'Start commit\n');
      const colon = commitFile(
        repo,
        'a.txt',
        'a\n',
        'Colon separator\n\nSigned-off-by: Ada Example <ada@example.org>\n',
      );
      const semicolon = commitFile(
        repo,
        'b.txt',
        'b\n',
        'Semicolon separator\n\nSigned-off-by; Ada Example <ada@example.org>\n',
      );

      const read = readGitCommitRange({ cwd: repo, range: `${start}..HEAD` });
      assert.equal(read.commits.length, 2);
      const byOid = new Map(read.commits.map((entry) => [entry.oid, entry]));
      assert.deepEqual(byOid.get(colon).trailers, [{ key: 'Signed-off-by', value: 'Ada Example <ada@example.org>' }]);
      assert.deepEqual(byOid.get(semicolon).trailers, []);
      // The local configuration keeps its own value.
      assert.equal(git(repo, ['config', '--get', 'trailer.separators']).trim(), ';');
    } finally {
      removeRepo(fixture);
    }
  });

  it('ignores an inherited GIT_DIR and never mutates the environment of the caller', () => {
    const first = createRepo();
    const second = createRepo();
    const previousGitDir = process.env.GIT_DIR;
    try {
      const firstOid = commitFile(first.repo, 'a.txt', 'a\n', 'First repository\n');
      const secondOid = commitFile(second.repo, 'b.txt', 'b\n', 'Second repository\n');

      process.env.GIT_DIR = path.join(first.repo, '.git');
      const keysBefore = Object.keys(process.env).sort();
      const read = readGitCommitRange({ cwd: second.repo, range: 'HEAD..HEAD' });
      assert.equal(read.base, secondOid);
      assert.notEqual(read.base, firstOid);
      assert.deepEqual(read.commits, []);

      // The caller keeps its own environment.
      assert.equal(process.env.GIT_DIR, path.join(first.repo, '.git'));
      assert.deepEqual(Object.keys(process.env).sort(), keysBefore);
    } finally {
      if (previousGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousGitDir;
      removeRepo(first);
      removeRepo(second);
    }
  });
});

describe('readGitCheckout: worktree root and head', () => {
  it('reads root and head at the repository root', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      commitFile(repo, 'a.txt', 'a\n', 'First\n');
      const read = readGitCheckout({ cwd: repo });
      assert.deepEqual(Object.keys(read).sort(), ['head', 'root']);
      assert.equal(read.root, repo);
      assert.equal(read.head, git(repo, ['rev-parse', 'HEAD']).trim());
      assert.match(read.head, OID_PATTERN);
    } finally {
      removeRepo(fixture);
    }
  });

  it('returns the same root and head from a nested working directory', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      const head = commitFile(repo, 'a.txt', 'a\n', 'First\n');
      const nested = path.join(repo, 'sub', 'dir');
      mkdirSync(nested, { recursive: true });
      const read = readGitCheckout({ cwd: nested });
      assert.equal(read.root, repo);
      assert.equal(read.head, head);
    } finally {
      removeRepo(fixture);
    }
  });

  it('keeps legitimate spaces in the repository path', () => {
    const root = mkdtempSync(path.join(tmpdir(), `${SESSION_PREFIX}space dir `));
    const fixture = { root, repo: path.join(root, 'wo rk') };
    try {
      mkdirSync(fixture.repo, { recursive: true });
      git(fixture.repo, ['init', '-q', '-b', 'main']);
      git(fixture.repo, ['config', 'user.name', 'Ada Example']);
      git(fixture.repo, ['config', 'user.email', 'ada@example.org']);
      git(fixture.repo, ['config', 'commit.gpgsign', 'false']);
      const head = commitFile(fixture.repo, 'a.txt', 'a\n', 'First\n');
      const read = readGitCheckout({ cwd: fixture.repo });
      assert.equal(read.root, fixture.repo);
      assert.equal(read.head, head);
    } finally {
      removeRepo(fixture);
    }
  });

  it('rejects malformed inputs with a constant data error', () => {
    const invalidCalls = [
      undefined,
      null,
      42,
      'repo',
      [],
      {},
      { cwd: '' },
      { cwd: 'relative/path' },
      { cwd: '/tmp/with\nnewline' },
      { cwd: '/tmp/with\0nul' },
    ];
    for (const options of invalidCalls) {
      assertDataInvalid(() => readGitCheckout(options), 'Lard');
    }
  });

  it('reports a constant git error outside a repository and without a head', () => {
    const outside = mkdtempSync(path.join(tmpdir(), SESSION_PREFIX));
    const emptyRoot = mkdtempSync(path.join(tmpdir(), SESSION_PREFIX));
    const emptyRepo = path.join(emptyRoot, 'repo');
    try {
      const missing = path.join(outside, 'missing-directory');
      assertGitError(() => readGitCheckout({ cwd: missing }));
      assertGitError(() => readGitCheckout({ cwd: outside }));
      mkdirSync(emptyRepo);
      git(emptyRepo, ['init', '-q', '-b', 'main']);
      assertGitError(() => readGitCheckout({ cwd: emptyRepo }));
    } finally {
      removeRepo({ root: outside });
      removeRepo({ root: emptyRoot });
    }
  });

  it('ignores inherited git environment and creates no trace output', () => {
    const first = createRepo();
    const second = createRepo();
    const tracePath = path.join(second.root, `${MARKER_TAG}-trace.log`);
    const previousGitDir = process.env.GIT_DIR;
    const previousWorkTree = process.env.GIT_WORK_TREE;
    const previousTrace = process.env.GIT_TRACE;
    try {
      const firstHead = commitFile(first.repo, 'a.txt', 'a\n', 'First repository\n');
      const secondHead = commitFile(second.repo, 'b.txt', 'b\n', 'Second repository\n');
      process.env.GIT_DIR = path.join(first.repo, '.git');
      process.env.GIT_WORK_TREE = first.repo;
      process.env.GIT_TRACE = tracePath;
      const read = readGitCheckout({ cwd: second.repo });
      assert.equal(read.root, second.repo);
      assert.equal(read.head, secondHead);
      assert.notEqual(read.head, firstHead);
      // The stripped GIT_TRACE setting creates no trace file at all.
      assert.equal(existsSync(tracePath), false);
    } finally {
      if (previousGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousGitDir;
      if (previousWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = previousWorkTree;
      if (previousTrace === undefined) delete process.env.GIT_TRACE;
      else process.env.GIT_TRACE = previousTrace;
      removeRepo(first);
      removeRepo(second);
    }
  });

  it('keeps raw git diagnostics out of the streams of the caller', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      commitFile(repo, 'a.txt', 'a\n', 'Base\n');
      const probeSource = `
const { pathToFileURL } = await import('node:url');
const adapter = await import(pathToFileURL(process.env.PROBE_MODULE).href);
try {
  adapter.readGitCheckout({ cwd: process.env.PROBE_REPO });
} catch (error) {
  process.exit(error.code === 'COMPLIANCE_GIT_ERROR' && error.message === process.env.PROBE_MESSAGE ? 0 : 3);
}
process.exit(4);
`;
      const probe = spawnSync(process.execPath, ['--input-type=module', '-e', probeSource], {
        env: {
          ...process.env,
          PROBE_MODULE: MODULE_PATH,
          PROBE_REPO: path.join(repo, `missing-${MARKER_TAG}`),
          PROBE_MESSAGE: GIT_ERROR_MESSAGE,
        },
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      assert.equal(probe.status, 0, `probe exited with ${probe.status}`);
      assert.equal(probe.stdout, '');
      assert.equal(probe.stderr, '');
      assert.equal(probe.stderr.includes(MARKER_TAG), false);
    } finally {
      removeRepo(fixture);
    }
  });
});

describe('readGitCommitRange: process streams', () => {
  it('keeps raw git diagnostics out of the streams of the caller', () => {
    const fixture = createRepo();
    try {
      const { repo } = fixture;
      commitFile(repo, 'a.txt', 'a\n', 'Base\n');
      const blob = git(repo, ['hash-object', '-w', '--stdin'], { input: 'blob content\n' }).trim();
      git(repo, ['tag', MARKER_TAG, blob]);

      // The child uses the real adapter and reports the expected error only
      // through its exit code. Everything that the adapter writes to stdout
      // or stderr has to stay inside the child.
      const probe = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE_SOURCE], {
        env: {
          ...process.env,
          PROBE_MODULE: MODULE_PATH,
          PROBE_REPO: repo,
          PROBE_RANGE: `${MARKER_TAG}..HEAD`,
          PROBE_MESSAGE: GIT_ERROR_MESSAGE,
        },
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      assert.equal(probe.status, 0, `probe exited with ${probe.status}`);
      assert.equal(probe.stdout, '');
      assert.equal(probe.stderr, '');
      assert.equal(probe.stderr.includes(MARKER_TAG), false);
    } finally {
      removeRepo(fixture);
    }
  });
});
