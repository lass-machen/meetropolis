// Tests for the compliance source parser runtime loader.
//
// The loader itself is imported dynamically inside the test cases, never
// statically: manifest and lock assertions must be able to fail on their
// own while the helper file is still missing. The sample source below is
// only parsed, never executed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const LOADER_FILENAME = 'parser-runtime.mjs';
const EXPECTED_PARSER_VERSION = '7.29.8';

// Single constant user message, shared with the loader implementation.
const EXPECTED_MESSAGE = 'The source parser is not available. Run "npm ci" in the gate checkout and repeat the check.';

// Self-authored sample covering TS, JSX, ESM and CJS shapes at once,
// with an escaped import specifier. Parsed only, never executed.
const SAMPLE_SOURCE = `import greeting from './\\u0067reeting';
type Locale = 'de' | 'en';
const locale: Locale = 'de';
const element = <p lang={locale}>{greeting}</p>;
module.exports = { element };
export default element;
`;

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));

const GATE_PREFIX = 'meetropolis-parser-gate-';
const REAL_PARSER_DIR = path.join(REPO_ROOT, 'node_modules', '@babel/parser');

// Child probe with a controlled literal import of the copied loader. The
// probe reports only through its exit code: 0 for the constant
// infrastructure error, 3 for any other error, 4 for an unexpected success.
const GATE_PROBE_SOURCE =
  `import { loadSourceParser } from './scripts/compliance/${LOADER_FILENAME}';\n` +
  'try {\n' +
  '  loadSourceParser();\n' +
  "  process.stdout.write('unexpected success');\n" +
  '  process.exitCode = 4;\n' +
  '} catch (error) {\n' +
  `  const ok = error.code === 'COMPLIANCE_PARSER_UNAVAILABLE' && error.exitCode === 2 && error.message === process.env.PROBE_MESSAGE;\n` +
  '  process.exitCode = ok ? 0 : 3;\n' +
  '}\n';

function removeFixtureDir(dir) {
  const resolved = path.resolve(dir);
  const tempRoot = path.resolve(os.tmpdir());
  assert.ok(path.basename(resolved).startsWith(GATE_PREFIX), 'refuse to remove a foreign directory');
  assert.ok(resolved.startsWith(`${tempRoot}${path.sep}`), 'refuse to remove a path outside the temp root');
  fs.rmSync(resolved, { recursive: true, force: true });
}

function runGateProbe(childDir) {
  const env = { ...process.env, PROBE_MESSAGE: EXPECTED_MESSAGE };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return spawnSync(process.execPath, ['--no-global-search-paths', 'probe.mjs'], {
    cwd: childDir,
    env,
    encoding: 'utf8',
  });
}

const INSTALLED_VERSION = readJson('package.json').devDependencies['@babel/parser'];

function otherExactVersion(version) {
  const parts = version.split('.').map(Number);
  parts[parts.length - 1] += 1;
  return parts.join('.');
}

// Valid own root metadata with all three expected pins, derived from the
// current checkout. The child checkout still has no own node_modules.
function writeRootMetadata(childDir, version) {
  fs.writeFileSync(
    path.join(childDir, 'package.json'),
    JSON.stringify({ name: 'gate-fixture', devDependencies: { '@babel/parser': version } }, null, 2),
  );
  fs.writeFileSync(
    path.join(childDir, 'package-lock.json'),
    JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          '': { devDependencies: { '@babel/parser': version } },
          'node_modules/@babel/parser': { version },
        },
      },
      null,
      2,
    ),
  );
}

// Child probe for the success case: exits 0 only when the loaded parser
// really parses, without printing anything.
const GATE_SUCCESS_PROBE_SOURCE =
  `import { loadSourceParser } from './scripts/compliance/${LOADER_FILENAME}';\n` +
  'try {\n' +
  '  const parser = loadSourceParser();\n' +
  "  const ast = parser.parse('export default 1;', { sourceType: 'module' });\n" +
  "  process.exitCode = ast && ast.type === 'File' ? 0 : 3;\n" +
  '} catch (error) {\n' +
  '  process.exitCode = 3;\n' +
  '}\n';

function assertGateAccepted(childDir) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const child = spawnSync(process.execPath, ['--no-global-search-paths', 'probe.mjs'], {
    cwd: childDir,
    env,
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, `probe exited with ${child.status}`);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
}

function assertGateRejected(child, childDir) {
  assert.equal(child.status, 0, `probe exited with ${child.status}`);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
  assert.ok(!child.stderr.includes(childDir));
  assert.ok(!child.stderr.includes('node_modules'));
  assert.ok(!child.stderr.includes('MODULE_NOT_FOUND'));
}

describe('parser runtime manifest', () => {
  it('declares the exact parser devDependency and no direct types dependency', () => {
    const manifest = readJson('package.json');
    const devDependencies = manifest.devDependencies ?? {};
    assert.equal(devDependencies['@babel/parser'], EXPECTED_PARSER_VERSION);
    assert.equal(devDependencies['@babel/types'], undefined);
    assert.equal(manifest.dependencies?.['@babel/types'], undefined);
  });

  it('pins the exact parser devDependency in the lockfile root entry', () => {
    const lockfile = readJson('package-lock.json');
    assert.equal(lockfile.packages?.['']?.devDependencies?.['@babel/parser'], EXPECTED_PARSER_VERSION);
  });

  it('keeps one consistent exact checkout pin across manifest and lockfile', () => {
    const manifest = readJson('package.json');
    const lockfile = readJson('package-lock.json');
    const fromManifest = manifest.devDependencies?.['@babel/parser'];
    const fromLockRoot = lockfile.packages?.['']?.devDependencies?.['@babel/parser'];
    const fromLockNode = lockfile.packages?.['node_modules/@babel/parser']?.version;
    for (const pin of [fromManifest, fromLockRoot, fromLockNode]) {
      assert.equal(typeof pin, 'string');
      assert.ok(pin.length > 0);
      assert.ok(/^[0-9]+\.[0-9]+\.[0-9]+$/.test(pin));
    }
    assert.equal(fromLockRoot, fromManifest);
    assert.equal(fromLockNode, fromManifest);
  });
});

describe('parser runtime loader', () => {
  it('returns a working parser for the sample source', async () => {
    const { loadSourceParser } = await import('./parser-runtime.mjs');
    const parser = loadSourceParser();
    assert.equal(typeof parser.parse, 'function');
    const ast = parser.parse(SAMPLE_SOURCE, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
    assert.equal(ast?.type, 'File');
    assert.ok(Array.isArray(ast.program?.body) && ast.program.body.length > 0);
  });

  it('reports only the constant message with exit code 2 when uninstalled', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetropolis-parser-fixture-'));
    try {
      fs.copyFileSync(path.join(HERE, LOADER_FILENAME), path.join(fixtureDir, LOADER_FILENAME));
      const runnerPath = path.join(fixtureDir, 'run-loader.mjs');
      fs.writeFileSync(
        runnerPath,
        `import { loadSourceParser } from './${LOADER_FILENAME}';\n` +
          'try {\n' +
          '  loadSourceParser();\n' +
          "  process.stdout.write('unexpected success');\n" +
          '  process.exitCode = 3;\n' +
          '} catch (error) {\n' +
          '  process.stderr.write(`${error.message}\\n`);\n' +
          '  process.exitCode = error.exitCode ?? 1;\n' +
          '}\n',
      );
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      const child = spawnSync(process.execPath, ['--no-global-search-paths', runnerPath], {
        cwd: fixtureDir,
        env,
        encoding: 'utf8',
      });
      assert.equal(child.status, 2);
      assert.equal(child.stdout, '');
      assert.equal(child.stderr, `${EXPECTED_MESSAGE}\n`);
      assert.ok(!child.stderr.includes(fixtureDir));
      assert.ok(!child.stderr.includes('node_modules'));
      assert.ok(!child.stderr.includes('MODULE_NOT_FOUND'));
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

describe('parser runtime gate checkout', () => {
  it('rejects a parent-only install with the constant infrastructure error', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), GATE_PREFIX));
    try {
      const childDir = path.join(fixtureDir, 'child');
      const loaderDir = path.join(childDir, 'scripts', 'compliance');
      fs.mkdirSync(loaderDir, { recursive: true });
      fs.copyFileSync(path.join(HERE, LOADER_FILENAME), path.join(loaderDir, LOADER_FILENAME));
      fs.writeFileSync(path.join(childDir, 'probe.mjs'), GATE_PROBE_SOURCE);
      // Valid own root metadata, but no own node_modules: only the path
      // regression may block the borrowed parent install, never a missing
      // source file.
      writeRootMetadata(childDir, INSTALLED_VERSION);
      // The child checkout has no own node_modules; the parent directory
      // offers the real installed parser through a borrowed symlink.
      const parentModules = path.join(fixtureDir, 'node_modules', '@babel');
      fs.mkdirSync(parentModules, { recursive: true });
      fs.symlinkSync(REAL_PARSER_DIR, path.join(parentModules, 'parser'), 'dir');
      const child = runGateProbe(childDir);
      assertGateRejected(child, childDir);
    } finally {
      removeFixtureDir(fixtureDir);
    }
  });

  it('rejects tampered version metadata without touching the real install', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), GATE_PREFIX));
    try {
      const childDir = path.join(fixtureDir, 'child');
      const loaderDir = path.join(childDir, 'scripts', 'compliance');
      fs.mkdirSync(loaderDir, { recursive: true });
      fs.copyFileSync(path.join(HERE, LOADER_FILENAME), path.join(loaderDir, LOADER_FILENAME));
      fs.writeFileSync(path.join(childDir, 'probe.mjs'), GATE_PROBE_SOURCE);
      // Valid own root metadata for the installed version.
      writeRootMetadata(childDir, INSTALLED_VERSION);
      // Real library bytes, but the version metadata of the temp copy is
      // rewritten; the repository installation stays untouched.
      const copyDir = path.join(childDir, 'node_modules', '@babel', 'parser');
      fs.mkdirSync(path.dirname(copyDir), { recursive: true });
      fs.cpSync(REAL_PARSER_DIR, copyDir, { recursive: true });
      const metaPath = path.join(copyDir, 'package.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      assert.equal(meta.version, EXPECTED_PARSER_VERSION);
      meta.version = '9.9.9';
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      const child = runGateProbe(childDir);
      assertGateRejected(child, childDir);
    } finally {
      removeFixtureDir(fixtureDir);
    }
  });

  it('loads the own install with matching root metadata', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), GATE_PREFIX));
    try {
      const childDir = path.join(fixtureDir, 'child');
      const loaderDir = path.join(childDir, 'scripts', 'compliance');
      fs.mkdirSync(loaderDir, { recursive: true });
      fs.copyFileSync(path.join(HERE, LOADER_FILENAME), path.join(loaderDir, LOADER_FILENAME));
      fs.writeFileSync(path.join(childDir, 'probe.mjs'), GATE_SUCCESS_PROBE_SOURCE);
      writeRootMetadata(childDir, INSTALLED_VERSION);
      const copyDir = path.join(childDir, 'node_modules', '@babel', 'parser');
      fs.mkdirSync(path.dirname(copyDir), { recursive: true });
      fs.cpSync(REAL_PARSER_DIR, copyDir, { recursive: true });
      assertGateAccepted(childDir);
    } finally {
      removeFixtureDir(fixtureDir);
    }
  });

  it('rejects a uniformly changed expected version against the real install', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), GATE_PREFIX));
    try {
      const childDir = path.join(fixtureDir, 'child');
      const loaderDir = path.join(childDir, 'scripts', 'compliance');
      fs.mkdirSync(loaderDir, { recursive: true });
      fs.copyFileSync(path.join(HERE, LOADER_FILENAME), path.join(loaderDir, LOADER_FILENAME));
      fs.writeFileSync(path.join(childDir, 'probe.mjs'), GATE_PROBE_SOURCE);
      // All three expected pins name another exact version while the real
      // installed parser stays untouched: a plain version mismatch.
      writeRootMetadata(childDir, otherExactVersion(INSTALLED_VERSION));
      const copyDir = path.join(childDir, 'node_modules', '@babel', 'parser');
      fs.mkdirSync(path.dirname(copyDir), { recursive: true });
      fs.cpSync(REAL_PARSER_DIR, copyDir, { recursive: true });
      const child = runGateProbe(childDir);
      assertGateRejected(child, childDir);
    } finally {
      removeFixtureDir(fixtureDir);
    }
  });

  it('rejects inconsistent, missing and non-string expected pins', () => {
    const variants = [
      (childDir) => {
        writeRootMetadata(childDir, INSTALLED_VERSION);
        const lockPath = path.join(childDir, 'package-lock.json');
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        delete lock.packages[''];
        fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
      },
      (childDir) => {
        writeRootMetadata(childDir, INSTALLED_VERSION);
        const lockPath = path.join(childDir, 'package-lock.json');
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        lock.packages['node_modules/@babel/parser'].version = 7298;
        fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
      },
      (childDir) => {
        writeRootMetadata(childDir, INSTALLED_VERSION);
        const lockPath = path.join(childDir, 'package-lock.json');
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        lock.packages['node_modules/@babel/parser'].version = otherExactVersion(INSTALLED_VERSION);
        fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
      },
      (childDir) => {
        writeRootMetadata(childDir, INSTALLED_VERSION);
        fs.writeFileSync(path.join(childDir, 'package.json'), '{ not json');
      },
    ];
    for (const setup of variants) {
      const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), GATE_PREFIX));
      try {
        const childDir = path.join(fixtureDir, 'child');
        const loaderDir = path.join(childDir, 'scripts', 'compliance');
        fs.mkdirSync(loaderDir, { recursive: true });
        fs.copyFileSync(path.join(HERE, LOADER_FILENAME), path.join(loaderDir, LOADER_FILENAME));
        fs.writeFileSync(path.join(childDir, 'probe.mjs'), GATE_PROBE_SOURCE);
        setup(childDir);
        const copyDir = path.join(childDir, 'node_modules', '@babel', 'parser');
        fs.mkdirSync(path.dirname(copyDir), { recursive: true });
        fs.cpSync(REAL_PARSER_DIR, copyDir, { recursive: true });
        const child = runGateProbe(childDir);
        assertGateRejected(child, childDir);
      } finally {
        removeFixtureDir(fixtureDir);
      }
    }
  });

  it('rejects an own install that is an external symlink', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), GATE_PREFIX));
    try {
      const childDir = path.join(fixtureDir, 'child');
      const loaderDir = path.join(childDir, 'scripts', 'compliance');
      fs.mkdirSync(loaderDir, { recursive: true });
      fs.copyFileSync(path.join(HERE, LOADER_FILENAME), path.join(loaderDir, LOADER_FILENAME));
      fs.writeFileSync(path.join(childDir, 'probe.mjs'), GATE_PROBE_SOURCE);
      writeRootMetadata(childDir, INSTALLED_VERSION);
      // The own node_modules entry exists but points outside the checkout.
      const scopeDir = path.join(childDir, 'node_modules', '@babel');
      fs.mkdirSync(scopeDir, { recursive: true });
      fs.symlinkSync(REAL_PARSER_DIR, path.join(scopeDir, 'parser'), 'dir');
      const child = runGateProbe(childDir);
      assertGateRejected(child, childDir);
    } finally {
      removeFixtureDir(fixtureDir);
    }
  });
});
