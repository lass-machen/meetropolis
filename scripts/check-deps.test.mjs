import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDeps } from './check-deps.mjs';

let tmp;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-deps-'));
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeFixture(name, options = {}) {
  const root = path.join(tmp, name);
  const wsDir = path.join(root, 'apps', 'a');
  fs.mkdirSync(path.join(wsDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-root',
        private: true,
        workspaces: ['apps/*'],
        dependencies: options.rootDeps ?? {},
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(wsDir, 'package.json'),
    JSON.stringify(
      {
        name: '@fixture/a',
        ...(options.wsDeps ? { dependencies: options.wsDeps } : {}),
        ...(options.wsDevDeps ? { devDependencies: options.wsDevDeps } : {}),
      },
      null,
      2,
    ),
  );
  for (const [rel, content] of Object.entries(options.files ?? {})) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  if (options.allowed) {
    fs.mkdirSync(path.join(root, 'compliance'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'compliance', 'policy.json'),
      JSON.stringify(
        {
          sourceImports: {
            allowedDynamicImports: options.allowed.map((specifier) => ({
              path: 'apps/a/src/loader.ts',
              specifier,
            })),
          },
        },
        null,
        2,
      ),
    );
  }
  return root;
}

describe('checkDeps', () => {
  it('(a) reports an undeclared import with file and line', () => {
    const root = makeFixture('a-undeclared', {
      files: {
        'apps/a/src/index.ts': "import { helper } from './helper.js';\nimport leftpad from 'leftpad';\n",
      },
    });
    const findings = checkDeps({ root });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].workspace, 'apps/a');
    assert.equal(findings[0].file, path.join('apps', 'a', 'src', 'index.ts'));
    assert.equal(findings[0].line, 2);
    assert.equal(findings[0].specifier, 'leftpad');
    assert.equal(findings[0].packageName, 'leftpad');
  });

  it('(b) accepts an import declared in the workspace', () => {
    const root = makeFixture('b-workspace-declared', {
      wsDeps: { leftpad: '^1.0.0' },
      files: {
        'apps/a/src/index.ts': "import leftpad from 'leftpad';\n",
      },
    });
    assert.deepEqual(checkDeps({ root }), []);
  });

  it('(c) accepts an import declared in the root package.json', () => {
    const root = makeFixture('c-root-declared', {
      rootDeps: { leftpad: '^1.0.0' },
      files: {
        'apps/a/src/index.ts': "import leftpad from 'leftpad';\n",
      },
    });
    assert.deepEqual(checkDeps({ root }), []);
  });

  it('(d) ignores node builtins and relative imports', () => {
    const root = makeFixture('d-builtins', {
      files: {
        'apps/a/src/index.ts':
          "import fs from 'node:fs';\nimport { readFile } from 'fs/promises';\nimport { helper } from './helper.js';\n",
      },
    });
    assert.deepEqual(checkDeps({ root }), []);
  });

  it('(e) maps a scoped subpath to the scoped package name', () => {
    const root = makeFixture('e-scoped', {
      files: {
        'apps/a/src/index.ts': "import { z } from '@a/b/c';\n",
      },
    });
    const findings = checkDeps({ root });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].specifier, '@a/b/c');
    assert.equal(findings[0].packageName, '@a/b');
  });

  it('(f) reports an undeclared import type import', () => {
    const root = makeFixture('f-import-type', {
      files: {
        'apps/a/src/index.ts': "import type { T } from 'mystery-pkg';\n",
      },
    });
    const findings = checkDeps({ root });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].specifier, 'mystery-pkg');
    assert.equal(findings[0].packageName, 'mystery-pkg');
  });

  it('(g) ignores specifiers allowed by policy.json', () => {
    const root = makeFixture('g-policy', {
      allowed: ['@meetropolis/tenancy'],
      files: {
        'apps/a/src/loader.ts': "const m = await import('@meetropolis/tenancy');\n",
      },
    });
    assert.deepEqual(checkDeps({ root }), []);
  });

  it('(h) does not read files under node_modules and dist', () => {
    const root = makeFixture('h-skipped-dirs', {
      files: {
        'apps/a/src/index.ts': "import fs from 'node:fs';\n",
        'apps/a/node_modules/evil/index.js': "require('evil-pkg');\n",
        'apps/a/dist/bundle.js': "require('evil-pkg');\n",
      },
    });
    assert.deepEqual(checkDeps({ root }), []);
  });
});
