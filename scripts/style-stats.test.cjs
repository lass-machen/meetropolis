#!/usr/bin/env node
// Tests for the style statistics ratchet.
//
// The suite drives the real stylelint API against temporary CSS files. There
// are no mocks and no fixtures outside the temporary directory.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CANONICAL_TOKEN_FILE, compareFileCounts, findCssFiles, runStyleStats } = require('./style-stats.cjs');

let stylelintPromise;

function loadStylelint() {
  stylelintPromise ??= import('stylelint').then((stylelintModule) => stylelintModule.default ?? stylelintModule);

  return stylelintPromise;
}

function createWorkspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'style-stats-'));

  return {
    directory,
    write(relativePath, content) {
      const absolutePath = path.join(directory, relativePath);

      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content, 'utf8');

      return { relativePath, absolutePath };
    },
    writeBaseline(baseline) {
      const baselinePath = path.join(directory, 'style-stats.json');

      fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

      return baselinePath;
    },
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function runCheck(workspace, { baseline, files }) {
  const baselinePath = workspace.writeBaseline(baseline);
  const targets = files.map((file) => workspace.write(file.path, file.css));

  return runStyleStats({
    root: workspace.directory,
    baselinePath,
    files: targets,
    stylelint: await loadStylelint(),
  });
}

test('die kanonische Token-Datei darf Hex-Werte enthalten', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: {} },
      files: [{ path: CANONICAL_TOKEN_FILE, css: ':root {\n  --brand: #ff0000;\n}\n' }],
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.regressions, []);
    assert.equal(result.ok, true);
    assert.equal(result.exemptFiles.length, 1);
    assert.equal(result.exemptFiles[0].hexes, 1);
  } finally {
    workspace.cleanup();
  }
});

test('a foreign tokens.css is blocked', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: {} },
      files: [{ path: 'tools/asset-lab/src/tokens.css', css: ':root {\n  --brand: #ff0000;\n}\n' }],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.regressions.length, 1);
    assert.equal(result.regressions[0].file, 'tools/asset-lab/src/tokens.css');
    assert.equal(result.regressions[0].hex, '#ff0000');
    assert.equal(result.regressions[0].kind, 'neuer Wert');
    assert.equal(result.ok, false);
  } finally {
    workspace.cleanup();
  }
});

test('new hex values and var() fallbacks are blocked', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: {} },
      files: [
        {
          path: 'apps/web/src/styles/theme.css',
          css: '.a {\n  color: #123456;\n  background: var(--surface, #abcdef);\n}\n',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.regressions.length, 2);
    assert.deepEqual(result.regressions.map((regression) => regression.hex).sort(), ['#123456', '#abcdef']);
  } finally {
    workspace.cleanup();
  }
});

test('comments, quoted values and url() are ignored', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: {} },
      files: [
        {
          path: 'apps/web/src/styles/theme.css',
          css: '/* #fff */\n.a {\n  content: "#fff";\n  background: url(#fff);\n  color: red;\n}\n',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.regressions, []);
    assert.equal(result.hexTotal, 0);
    assert.equal(result.ok, true);
  } finally {
    workspace.cleanup();
  }
});

test('a disable comment must not switch off the hex check', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: {} },
      files: [
        {
          path: 'apps/web/src/styles/theme.css',
          css: '/* stylelint-disable color-no-hex */\n.a {\n  color: #123456;\n}\n',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.regressions.length, 1);
    assert.equal(result.regressions[0].hex, '#123456');
    assert.equal(result.regressions[0].kind, 'neuer Wert');
    assert.equal(result.hexTotal, 1);
    assert.equal(result.ok, false);
  } finally {
    workspace.cleanup();
  }
});

test('a disable-next-line comment must not switch off the hex check', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: {} },
      files: [
        {
          path: 'apps/web/src/styles/theme.css',
          css: '/* stylelint-disable-next-line color-no-hex */\n.a { color: #123456; }\n',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.regressions.length, 1);
    assert.equal(result.regressions[0].hex, '#123456');
    assert.equal(result.regressions[0].kind, 'neuer Wert');
    assert.equal(result.hexTotal, 1);
    assert.equal(result.ok, false);
  } finally {
    workspace.cleanup();
  }
});

test('a disable-line comment must not switch off the hex check', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: {} },
      files: [
        {
          path: 'apps/web/src/styles/theme.css',
          css: '.a { color: #123456; /* stylelint-disable-line color-no-hex */ }\n',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.regressions.length, 1);
    assert.equal(result.regressions[0].hex, '#123456');
    assert.equal(result.regressions[0].kind, 'neuer Wert');
    assert.equal(result.hexTotal, 1);
    assert.equal(result.ok, false);
  } finally {
    workspace.cleanup();
  }
});

test('the canonical token file stays allowed even with a disable comment', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: {} },
      files: [
        {
          path: CANONICAL_TOKEN_FILE,
          css: '/* stylelint-disable color-no-hex */\n:root {\n  --brand: #ff0000;\n}\n',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.regressions, []);
    assert.equal(result.ok, true);
    assert.equal(result.exemptFiles.length, 1);
    assert.equal(result.exemptFiles[0].hexes, 1);
  } finally {
    workspace.cleanup();
  }
});

test('a foreign tokens.css with a disable comment is blocked', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: {} },
      files: [
        {
          path: 'tools/asset-lab/src/tokens.css',
          css: '/* stylelint-disable color-no-hex */\n:root {\n  --brand: #ff0000;\n}\n',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.regressions.length, 1);
    assert.equal(result.regressions[0].file, 'tools/asset-lab/src/tokens.css');
    assert.equal(result.regressions[0].hex, '#ff0000');
    assert.equal(result.regressions[0].kind, 'neuer Wert');
    assert.equal(result.ok, false);
  } finally {
    workspace.cleanup();
  }
});

test('the same hex value appearing more often is a regression', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: { 'apps/web/src/styles/theme.css': { '#fff': 1 } } },
      files: [
        {
          path: 'apps/web/src/styles/theme.css',
          css: '.a {\n  color: #fff;\n}\n.b {\n  color: #fff;\n}\n',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.regressions.length, 1);
    assert.equal(result.regressions[0].hex, '#fff');
    assert.equal(result.regressions[0].baseline, 1);
    assert.equal(result.regressions[0].current, 2);
    assert.equal(result.regressions[0].kind, 'Anzahl gestiegen');
  } finally {
    workspace.cleanup();
  }
});

test('a different value with the same total is a regression', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: { 'apps/web/src/styles/theme.css': { '#aaa': 1, '#bbb': 1 } } },
      files: [
        {
          path: 'apps/web/src/styles/theme.css',
          css: '.a {\n  color: #aaa;\n}\n.b {\n  color: #ccc;\n}\n',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.regressions.length, 1);
    assert.equal(result.regressions[0].hex, '#ccc');
    assert.equal(result.regressions[0].kind, 'neuer Wert');
  } finally {
    workspace.cleanup();
  }
});

test('a reduction is allowed', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: { 'apps/web/src/styles/theme.css': { '#fff': 2 } } },
      files: [{ path: 'apps/web/src/styles/theme.css', css: '.a {\n  color: #fff;\n}\n' }],
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.regressions, []);
    assert.equal(result.hexTotal, 1);
    assert.equal(result.ok, true);
  } finally {
    workspace.cleanup();
  }
});

test('malformed CSS fails the run', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: {} },
      files: [{ path: 'apps/web/src/styles/theme.css', css: '.a {\n  color: #fff;\n' }],
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
    assert.deepEqual(result.regressions, []);
  } finally {
    workspace.cleanup();
  }
});

test('a missing baseline fails the run', async () => {
  const workspace = createWorkspace();

  try {
    const target = workspace.write('apps/web/src/styles/theme.css', '.a {\n  color: red;\n}\n');
    const result = await runStyleStats({
      root: workspace.directory,
      baselinePath: path.join(workspace.directory, 'missing-style-stats.json'),
      files: [target],
      stylelint: await loadStylelint(),
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Baseline/);
  } finally {
    workspace.cleanup();
  }
});

test('a baseline with the wrong version fails the run', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 2, files: {} },
      files: [{ path: 'apps/web/src/styles/theme.css', css: '.a {\n  color: red;\n}\n' }],
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Version/);
  } finally {
    workspace.cleanup();
  }
});

test('a baseline with an invalid hex value fails the run', async () => {
  const workspace = createWorkspace();

  try {
    const result = await runCheck(workspace, {
      baseline: { version: 1, files: { 'apps/web/src/styles/theme.css': { '#FFF': 1 } } },
      files: [{ path: 'apps/web/src/styles/theme.css', css: '.a {\n  color: red;\n}\n' }],
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Hex-Wert/);
  } finally {
    workspace.cleanup();
  }
});

test('the comparison reports per file and value', () => {
  const regressions = compareFileCounts(
    new Map([
      ['#fff', 2],
      ['#aaa', 1],
    ]),
    new Map([
      ['#fff', 1],
      ['#bbb', 1],
    ]),
  );

  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].hex, '#bbb');
  assert.equal(regressions[0].baseline, 0);
  assert.equal(regressions[0].current, 1);
});

test('the file search returns POSIX paths and skips symlinks', () => {
  const workspace = createWorkspace();

  try {
    workspace.write('apps/web/src/styles/theme.css', '.a {\n  color: red;\n}\n');
    workspace.write('dist/bundle.css', '.b {\n  color: red;\n}\n');
    workspace.write('node_modules/pkg/index.css', '.c {\n  color: red;\n}\n');
    fs.symlinkSync(
      path.join(workspace.directory, 'apps/web/src/styles/theme.css'),
      path.join(workspace.directory, 'linked.css'),
    );

    assert.deepEqual(findCssFiles(workspace.directory), ['apps/web/src/styles/theme.css']);
  } finally {
    workspace.cleanup();
  }
});

test('a missing root directory fails the run', async () => {
  const workspace = createWorkspace();

  try {
    const baselinePath = workspace.writeBaseline({ version: 1, files: {} });
    const missingRoot = path.join(workspace.directory, 'does-not-exist');

    const result = await runStyleStats({
      root: missingRoot,
      baselinePath,
      stylelint: await loadStylelint(),
    });

    assert.equal(result.ok, false);
    assert.equal(result.checkedFiles, 0);
    assert.equal(result.hexTotal, 0);
    assert.deepEqual(result.regressions, []);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Dateisuche/);
    assert.ok(result.errors[0].includes(missingRoot));
  } finally {
    workspace.cleanup();
  }
});

test('an unreadable subdirectory fails the run', async (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('root bypasses the filesystem permission check');
    return;
  }

  const workspace = createWorkspace();
  const lockedDirectory = path.join(workspace.directory, 'locked');

  fs.mkdirSync(lockedDirectory, { recursive: true });
  fs.writeFileSync(path.join(lockedDirectory, 'theme.css'), '.a {\n  color: #123456;\n}\n', 'utf8');
  fs.chmodSync(lockedDirectory, 0o000);

  try {
    const baselinePath = workspace.writeBaseline({ version: 1, files: {} });

    const result = await runStyleStats({
      root: workspace.directory,
      baselinePath,
      stylelint: await loadStylelint(),
    });

    assert.equal(result.ok, false);
    assert.equal(result.checkedFiles, 0);
    assert.equal(result.hexTotal, 0);
    assert.deepEqual(result.regressions, []);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Dateisuche/);
  } finally {
    fs.chmodSync(lockedDirectory, 0o700);
    workspace.cleanup();
  }
});
