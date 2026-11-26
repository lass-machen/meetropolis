#!/usr/bin/env node
// Tests for the function-length budget enforcement.
//
// The suite drives the real scripts/enforce-budgets.js as a child process
// against a temporary workspace. There are no mocks and no fixtures outside
// the temporary directory.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ENFORCE_BUDGETS = path.join(__dirname, 'enforce-budgets.js');

function createWorkspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-budgets-'));

  return {
    directory,
    write(relativePath, content) {
      const absolutePath = path.join(directory, relativePath);

      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content, 'utf8');

      return absolutePath;
    },
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function runBudgets(directory) {
  return spawnSync(process.execPath, [ENFORCE_BUDGETS], {
    cwd: directory,
    encoding: 'utf8',
  });
}

function longFunctionWithDefaultOptions(lineCount) {
  const body = [];
  for (let i = 0; i < lineCount; i += 1) {
    body.push(`  total += ${i};`);
  }
  return [
    'export async function longOperation(',
    '  store: Store,',
    '  id: string,',
    '  options: OperationOptions = {},',
    '): Promise<number> {',
    '  let total = 0;',
    ...body,
    '  return total;',
    '}',
    '',
  ].join('\n');
}

test('a long function with a "= {}" default parameter is reported', () => {
  const workspace = createWorkspace();

  try {
    workspace.write('apps/server/src/probe.ts', longFunctionWithDefaultOptions(85));

    const result = runBudgets(workspace.directory);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /probe\.ts/);
  } finally {
    workspace.cleanup();
  }
});

test('a short function with a "= {}" default parameter passes', () => {
  const workspace = createWorkspace();

  try {
    workspace.write(
      'apps/server/src/probe.ts',
      [
        'export async function shortOperation(',
        '  store: Store,',
        '  id: string,',
        '  options: OperationOptions = {},',
        '): Promise<number> {',
        '  return 1;',
        '}',
        '',
      ].join('\n'),
    );

    const result = runBudgets(workspace.directory);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /no budget violations/);
  } finally {
    workspace.cleanup();
  }
});
