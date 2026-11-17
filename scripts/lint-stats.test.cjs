#!/usr/bin/env node
// Tests for the lint statistics inline-style ratchet.
//
// The suite drives the real Babel parser against inline sources and temporary
// TSX files. There are no mocks and no fixtures outside the temporary
// directory.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { compareInlineStyles, countInlineStyles, countInlineStylesInSource, findTsxFiles } = require('./lint-stats.cjs');

function createWorkspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-stats-'));

  return {
    directory,
    write(relativePath, content) {
      const absolutePath = path.join(directory, relativePath);

      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content, 'utf8');

      return { relativePath, absolutePath };
    },
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('a hex color in an inline style object counts one object and one color', () => {
  const counts = countInlineStylesInSource(
    "export function A() { return <div style={{ color: '#fff' }} />; }\n",
    'a.tsx',
  );

  assert.deepEqual(counts, { styleObjects: 1, colorLiterals: 1 });
});

test('a template literal rgba counts while a var reference does not', () => {
  const counts = countInlineStylesInSource(
    "export function A() { return <div style={{ background: `rgba(0,0,0,.5)`, borderColor: 'var(--x)' }} />; }\n",
    'a.tsx',
  );

  assert.deepEqual(counts, { styleObjects: 1, colorLiterals: 1 });
});

test('an identifier style and a className count nothing', () => {
  const counts = countInlineStylesInSource(
    'const styles = {};\nexport function A() { return <div style={styles} className="card" />; }\n',
    'a.tsx',
  );

  assert.deepEqual(counts, { styleObjects: 0, colorLiterals: 0 });
});

test('two hex values in one string count two colors in one object', () => {
  const counts = countInlineStylesInSource(
    "export function A() { return <div style={{ borderColor: '#123456 #abc' }} />; }\n",
    'a.tsx',
  );

  assert.deepEqual(counts, { styleObjects: 1, colorLiterals: 2 });
});

test('a syntax error reports the file path', () => {
  assert.throws(() => countInlineStylesInSource('const = {{{', 'broken.tsx'), /broken\.tsx/);
});

test('the directory scan sums two files and skips node_modules', () => {
  const workspace = createWorkspace();

  try {
    workspace.write('apps/web/src/a.tsx', "export function A() { return <div style={{ color: '#fff' }} />; }\n");
    workspace.write(
      'apps/web/src/sub/b.tsx',
      'export function B() { return <span style={{ background: `rgba(0,0,0,.5)` }} className="x" />; }\n',
    );
    workspace.write('apps/web/src/plain.ts', 'export const x = 1;\n');
    workspace.write(
      'apps/web/src/node_modules/skip.tsx',
      "export function S() { return <div style={{ color: '#000' }} />; }\n",
    );

    const files = findTsxFiles(workspace.directory);

    assert.deepEqual(files, [...files].sort());
    assert.equal(files.length, 2);
    assert.deepEqual(countInlineStyles(workspace.directory), { styleObjects: 2, colorLiterals: 2 });
  } finally {
    workspace.cleanup();
  }
});

test('a rising counter is a regression', () => {
  const regressions = compareInlineStyles({ styleObjects: 3, colorLiterals: 2 }, { styleObjects: 2, colorLiterals: 2 });

  assert.equal(regressions.length, 1);
  assert.deepEqual(regressions[0], { metric: 'styleObjects', baseline: 2, current: 3 });
});

test('equal and falling counters are no regression', () => {
  assert.deepEqual(
    compareInlineStyles({ styleObjects: 2, colorLiterals: 1 }, { styleObjects: 2, colorLiterals: 2 }),
    [],
  );
  assert.deepEqual(
    compareInlineStyles({ styleObjects: 0, colorLiterals: 0 }, { styleObjects: 2, colorLiterals: 2 }),
    [],
  );
});

test('a missing baseline or metric throws', () => {
  assert.throws(
    () => compareInlineStyles({ styleObjects: 1, colorLiterals: 0 }, undefined),
    /inline style baseline missing/,
  );
  assert.throws(() => compareInlineStyles({ styleObjects: 1, colorLiterals: 0 }, {}), /inline style baseline missing/);
  assert.throws(
    () => compareInlineStyles({ styleObjects: 1, colorLiterals: 0 }, { styleObjects: 1 }),
    /inline style baseline missing/,
  );
});
