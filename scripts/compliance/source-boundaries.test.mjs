// Tests for the source boundary check.
//
// The check validates the dynamic import boundaries of repository sources
// against the sourceImports policy section. Only this test file touches
// the file system (to read the real policy as a fixture base); the module
// itself receives file bytes through a map and never reads, writes or
// executes anything. Hashes below are computed from synthetic bytes, no
// real binary asset is copied.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSourceBoundaries } from './source-boundaries.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';

const POLICY_PATH = 'compliance/policy.json';
const COLLISION_PATH = 'tools/asset-lab/tests/collision.test.ts';
const COLLISION_TARGET = 'apps/server/src/api/utils/collisionHelpers.ts';
const PLUGIN_PATH = 'apps/web/optional-submodules.ts';

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function basePolicy() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, POLICY_PATH), 'utf8'));
}

function policyBytes(mutate) {
  const policy = JSON.parse(JSON.stringify(basePolicy()));
  if (mutate) mutate(policy);
  return Buffer.from(JSON.stringify(policy), 'utf8');
}

function toMap(entries) {
  return new Map(
    Object.entries(entries).map(([name, value]) => [
      name,
      typeof value === 'string' ? Buffer.from(value, 'utf8') : value,
    ]),
  );
}

function run(entries) {
  return checkSourceBoundaries({ files: toMap(entries) });
}

function issueCodes(result) {
  return result.issues.map((issue) => issue.code);
}

function assertInvalid(call, markers = []) {
  assert.throws(call, (error) => {
    assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
    assert.equal(error.exitCode, 2);
    assert.equal(error.message, DATA_INVALID_MESSAGE);
    for (const marker of markers) {
      if (marker.length === 0) continue;
      assert.ok(!error.message.includes(marker), `leaked marker ${marker}`);
    }
    return true;
  });
}

const LOADER_PAIRS = basePolicy().sourceImports.allowedDynamicImports.map((entry) => [entry.path, entry.specifier]);

// Policy with the real allow pairs but fixture pins, so allow tests run
// without the real pinned bytes: plugin pin present with synthetic bytes,
// no dynamic pins.
function allowPolicy() {
  const policy = JSON.parse(JSON.stringify(basePolicy()));
  policy.sourceImports.pinnedFiles = [
    {
      path: PLUGIN_PATH,
      sha256: sha256Hex(Buffer.from('export {};\n', 'utf8')),
      reason: 'Fixture plugin pin.',
    },
  ];
  policy.sourceImports.pinnedDynamicImports = [];
  return Buffer.from(JSON.stringify(policy), 'utf8');
}

function allowEntries(extra) {
  return { [POLICY_PATH]: allowPolicy(), [PLUGIN_PATH]: 'export {};\n', ...extra };
}

const loaderSource = (specifier) => `export async function load() {\n  return import('${specifier}');\n}\n`;

describe('checkSourceBoundaries allow list', () => {
  it('accepts all ten real loader pairs as dynamic literal imports', () => {
    const entries = allowEntries(
      Object.fromEntries(LOADER_PAIRS.map(([file, specifier]) => [file, loaderSource(specifier)])),
    );
    const result = run(entries);
    assert.deepEqual(result.issues, []);
    assert.equal(result.records.length, 10);
    for (const record of result.records) {
      assert.deepEqual(Object.keys(record).sort(), ['argumentKind', 'column', 'kind', 'line', 'path', 'typeOnly']);
    }
    assert.ok(!JSON.stringify(result).includes('@meetropolis/'));
  });

  it('rejects the same targets outside their loader', () => {
    const result = run({
      [POLICY_PATH]: allowPolicy(),
      [PLUGIN_PATH]: 'export {};\n',
      'apps/server/src/other.ts': loaderSource('@meetropolis/tenancy'),
    });
    assert.deepEqual(issueCodes(result), ['SOURCE_IMPORT_FORBIDDEN']);
    assert.equal(result.issues[0].path, 'apps/server/src/other.ts');
  });

  it('rejects a known loader with the wrong target', () => {
    const result = run({
      [POLICY_PATH]: allowPolicy(),
      [PLUGIN_PATH]: 'export {};\n',
      'apps/server/src/tenancyLoader.ts': loaderSource('@meetropolis/billing'),
    });
    assert.deepEqual(issueCodes(result), ['SOURCE_IMPORT_FORBIDDEN']);
  });

  it('rejects static, type-only, reexport and require shapes in the right loader', () => {
    const sources = {
      'apps/server/src/tenancyLoader.ts': "import cached from '@meetropolis/tenancy';\nexport default cached;\n",
      'apps/server/src/billingLoader.ts': "import type { T } from '@meetropolis/billing';\nexport type { T };\n",
      'apps/server/src/adminLoader.ts': "export * from '@meetropolis/billing';\n",
      'apps/server/src/emailLoader.ts': "const m = require('@meetropolis/tenancy');\n",
    };
    const result = run({ [POLICY_PATH]: allowPolicy(), [PLUGIN_PATH]: 'export {};\n', ...sources });
    assert.equal(result.issues.length, 4);
    assert.ok(result.issues.every((issue) => issue.code === 'SOURCE_IMPORT_FORBIDDEN'));
  });

  it('rejects subpath, template, query and case variants in the right loader', () => {
    const sources = {
      'apps/server/src/tenancyLoader.ts': loaderSource('@meetropolis/tenancy/sub'),
      'apps/server/src/billingLoader.ts':
        'export async function load() {\n  return import(`@meetropolis/billing${""}`);\n}\n',
      'apps/server/src/adminLoader.ts': loaderSource('@meetropolis/billing?x=1'),
      'apps/server/src/emailLoader.ts': loaderSource('@Meetropolis/Tenancy'),
    };
    const result = run({ [POLICY_PATH]: allowPolicy(), [PLUGIN_PATH]: 'export {};\n', ...sources });
    assert.equal(result.issues.length, 4);
    const byPath = new Map(result.issues.map((issue) => [issue.path, issue.code]));
    assert.equal(byPath.get('apps/server/src/tenancyLoader.ts'), 'SOURCE_IMPORT_FORBIDDEN');
    assert.equal(byPath.get('apps/server/src/billingLoader.ts'), 'SOURCE_NON_LITERAL_IMPORT');
    assert.equal(byPath.get('apps/server/src/adminLoader.ts'), 'SOURCE_IMPORT_FORBIDDEN');
    assert.equal(byPath.get('apps/server/src/emailLoader.ts'), 'SOURCE_IMPORT_FORBIDDEN');
  });

  it('rejects signalyr everywhere and tauri under apps/web even in loaders', () => {
    const result = run({
      [POLICY_PATH]: allowPolicy(),
      [PLUGIN_PATH]: 'export {};\n',
      'apps/server/src/other.ts': loaderSource('@signalyr/relay'),
      'apps/web/src/lib/brandLoader.ts': loaderSource('@tauri-apps/api'),
    });
    assert.equal(result.issues.length, 2);
    const byPath = new Map(result.issues.map((issue) => [issue.path, issue.code]));
    assert.equal(byPath.get('apps/server/src/other.ts'), 'SOURCE_IMPORT_FORBIDDEN');
    assert.equal(byPath.get('apps/web/src/lib/brandLoader.ts'), 'SOURCE_WEB_SCOPE_FORBIDDEN');
  });

  it('leaves unprotected literals and near-family prefixes alone', () => {
    const result = run({
      [POLICY_PATH]: allowPolicy(),
      [PLUGIN_PATH]: 'export {};\n',
      'apps/server/src/other.ts': "import { x } from 'lodash';\n",
      'apps/server/src/feature.ts': loaderSource('@meetropolis/enterprises'),
    });
    assert.deepEqual(result.issues, []);
    assert.equal(result.records.length, 2);
  });

  it('rejects a hyphen-family target without an allow pair', () => {
    const result = run({
      [POLICY_PATH]: allowPolicy(),
      [PLUGIN_PATH]: 'export {};\n',
      'apps/server/src/other.ts': loaderSource('@meetropolis/enterprise-web'),
    });
    assert.deepEqual(issueCodes(result), ['SOURCE_IMPORT_FORBIDDEN']);
  });

  it('covers family subpaths but not near-prefix subpaths', () => {
    const sources = {
      'apps/server/src/a.ts': loaderSource('@meetropolis/enterprise/internal'),
      'apps/server/src/b.ts': loaderSource('@meetropolis/brand/internal'),
      'apps/server/src/c.ts': loaderSource('@meetropolis/desktop/internal'),
      'apps/server/src/d.ts': loaderSource('@meetropolis/telemetry/internal'),
      'apps/server/src/e.ts': loaderSource('@meetropolis/enterprise-web/sub'),
    };
    const result = run({ [POLICY_PATH]: allowPolicy(), [PLUGIN_PATH]: 'export {};\n', ...sources });
    assert.equal(result.issues.length, 5);
    assert.ok(result.issues.every((issue) => issue.code === 'SOURCE_IMPORT_FORBIDDEN'));
    const green = run({
      [POLICY_PATH]: allowPolicy(),
      [PLUGIN_PATH]: 'export {};\n',
      'apps/server/src/other.ts': loaderSource('@meetropolis/enterprises/internal'),
    });
    assert.deepEqual(green.issues, []);
  });

  it('rejects an unknown dynamic identifier target', () => {
    const result = run({
      [POLICY_PATH]: allowPolicy(),
      [PLUGIN_PATH]: 'export {};\n',
      'apps/server/src/other.ts': 'export async function load(name) {\n  return import(name);\n}\n',
    });
    assert.deepEqual(issueCodes(result), ['SOURCE_NON_LITERAL_IMPORT']);
  });

  it('keeps raw values out of records, issues and errors', () => {
    const result = run({
      [POLICY_PATH]: fixturePolicy({}),
      [PLUGIN_PATH]: 'export {};\n',
      'apps/server/src/other.ts': loaderSource('@evil/MARKER-ROOT'),
    });
    assert.deepEqual(result.issues, []);
    assert.ok(!JSON.stringify(result).includes('MARKER-ROOT'));
    assertInvalid(() => run({ [POLICY_PATH]: Buffer.from('MARKER-NOT-JSON', 'utf8') }), ['MARKER-NOT-JSON']);
  });
});

const COLLISION_LINE = 15;

function collisionSource(extra = '') {
  const filler = Array.from({ length: 14 }, (_, index) => `// filler line ${index + 1}\n`).join('');
  return `${filler}const { computeFootprintTiles } = (await import(serverModule));\n${extra}`;
}

function fixturePolicy({ pluginBytes = null, collisionBytes = null, collisionLine = COLLISION_LINE }) {
  return policyBytes((policy) => {
    const pluginContent = pluginBytes === null ? 'export {};\n' : pluginBytes;
    policy.sourceImports.pinnedFiles = [
      {
        path: PLUGIN_PATH,
        sha256: sha256Hex(Buffer.from(pluginContent, 'utf8')),
        reason: 'Fixture plugin pin.',
      },
    ];
    if (collisionBytes === null) {
      policy.sourceImports.pinnedDynamicImports = [];
    } else {
      policy.sourceImports.pinnedDynamicImports = [
        {
          path: COLLISION_PATH,
          sha256: sha256Hex(Buffer.from(collisionBytes, 'utf8')),
          kind: 'dynamic-import',
          argumentKind: 'identifier',
          line: collisionLine,
          targetPath: COLLISION_TARGET,
          reason: 'Fixture collision pin.',
        },
      ];
    }
  });
}

describe('checkSourceBoundaries dynamic pin', () => {
  it('passes one fully pinned non-literal record', () => {
    const content = collisionSource();
    const result = run({
      [POLICY_PATH]: fixturePolicy({ collisionBytes: content }),
      [PLUGIN_PATH]: 'export {};\n',
      [COLLISION_PATH]: content,
      [COLLISION_TARGET]: 'export const computeFootprintTiles = () => [];\n',
    });
    assert.deepEqual(result.issues, []);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].argumentKind, 'identifier');
  });

  it('reports drifted, missing and untargeted pins', () => {
    const content = collisionSource();
    const drifted = run({
      [POLICY_PATH]: fixturePolicy({ collisionBytes: content }),
      [PLUGIN_PATH]: 'export {};\n',
      [COLLISION_PATH]: `${content}// drift\n`,
      [COLLISION_TARGET]: 'export const computeFootprintTiles = () => [];\n',
    });
    assert.deepEqual(issueCodes(drifted), ['SOURCE_PIN_MISMATCH', 'SOURCE_NON_LITERAL_IMPORT']);
    const missing = run({
      [POLICY_PATH]: fixturePolicy({ collisionBytes: content }),
      [PLUGIN_PATH]: 'export {};\n',
      [COLLISION_TARGET]: 'export const computeFootprintTiles = () => [];\n',
    });
    assert.deepEqual(issueCodes(missing), ['SOURCE_PIN_MISSING']);
    const noTarget = run({
      [POLICY_PATH]: fixturePolicy({ collisionBytes: content }),
      [PLUGIN_PATH]: 'export {};\n',
      [COLLISION_PATH]: content,
    });
    assert.deepEqual(issueCodes(noTarget), ['SOURCE_PIN_TARGET_MISSING', 'SOURCE_NON_LITERAL_IMPORT']);
  });

  it('keeps checking drifted or untargeted files completely', () => {
    const clean = collisionSource();
    const driftedPlugin = `export {};\nimport cached from '@meetropolis/tenancy';\n`;
    const pluginResult = run({
      [POLICY_PATH]: fixturePolicy({}),
      [PLUGIN_PATH]: driftedPlugin,
    });
    assert.deepEqual(issueCodes(pluginResult), ['SOURCE_PIN_MISMATCH', 'SOURCE_IMPORT_FORBIDDEN']);
    assert.equal(pluginResult.records.length, 1);
    assert.equal(pluginResult.records[0].kind, 'import');
    const driftedContent = collisionSource("import cached from '@meetropolis/tenancy';\n");
    const collisionResult = run({
      [POLICY_PATH]: fixturePolicy({ collisionBytes: clean }),
      [PLUGIN_PATH]: 'export {};\n',
      [COLLISION_PATH]: driftedContent,
      [COLLISION_TARGET]: 'export const computeFootprintTiles = () => [];\n',
    });
    assert.deepEqual(issueCodes(collisionResult), [
      'SOURCE_PIN_MISMATCH',
      'SOURCE_NON_LITERAL_IMPORT',
      'SOURCE_IMPORT_FORBIDDEN',
    ]);
    const noTargetContent = collisionSource("import cached from '@meetropolis/tenancy';\n");
    const noTargetResult = run({
      [POLICY_PATH]: fixturePolicy({ collisionBytes: noTargetContent }),
      [PLUGIN_PATH]: 'export {};\n',
      [COLLISION_PATH]: noTargetContent,
    });
    assert.deepEqual(issueCodes(noTargetResult), [
      'SOURCE_PIN_TARGET_MISSING',
      'SOURCE_NON_LITERAL_IMPORT',
      'SOURCE_IMPORT_FORBIDDEN',
    ]);
  });

  it('keeps syntax findings of drifted pinned sources', () => {
    const clean = collisionSource();
    const result = run({
      [POLICY_PATH]: fixturePolicy({ collisionBytes: clean }),
      [PLUGIN_PATH]: 'export {};\n',
      [COLLISION_PATH]: 'const = ;\n',
      [COLLISION_TARGET]: 'export const computeFootprintTiles = () => [];\n',
    });
    assert.deepEqual([...issueCodes(result)].sort(), [
      'SOURCE_DYNAMIC_PIN_STALE',
      'SOURCE_PARSE_FAILED',
      'SOURCE_PIN_MISMATCH',
    ]);
  });

  it('throws infra for drifted pins with invalid utf8', () => {
    const clean = collisionSource();
    assertInvalid(
      () =>
        run({
          [POLICY_PATH]: fixturePolicy({ collisionBytes: clean }),
          [PLUGIN_PATH]: 'export {};\n',
          [COLLISION_PATH]: Buffer.from([0xff, 0xfe]),
          [COLLISION_TARGET]: 'export const computeFootprintTiles = () => [];\n',
        }),
      [],
    );
    assertInvalid(
      () =>
        run({
          [POLICY_PATH]: fixturePolicy({}),
          [PLUGIN_PATH]: Buffer.from([0xff, 0xfe]),
        }),
      [],
    );
  });

  it('reports zero or several matching records as stale', () => {
    const fillerOnly = `${Array.from({ length: 20 }, (_, index) => `// filler ${index + 1}\n`).join('')}export const x = 1;\n`;
    const staleZero = run({
      [POLICY_PATH]: fixturePolicy({ collisionBytes: fillerOnly }),
      [PLUGIN_PATH]: 'export {};\n',
      [COLLISION_PATH]: fillerOnly,
      [COLLISION_TARGET]: 'export const computeFootprintTiles = () => [];\n',
    });
    assert.ok(issueCodes(staleZero).includes('SOURCE_DYNAMIC_PIN_STALE'));
    const twoOnLine = `${Array.from({ length: 14 }, (_, index) => `// filler ${index + 1}\n`).join('')}const a = await import(x), b = await import(y);\n`;
    const staleTwo = run({
      [POLICY_PATH]: fixturePolicy({ collisionBytes: twoOnLine }),
      [PLUGIN_PATH]: 'export {};\n',
      [COLLISION_PATH]: twoOnLine,
      [COLLISION_TARGET]: 'export const computeFootprintTiles = () => [];\n',
    });
    assert.ok(issueCodes(staleTwo).includes('SOURCE_DYNAMIC_PIN_STALE'));
  });

  it('still checks further imports of a pinned file normally', () => {
    const content = collisionSource("import cached from '@meetropolis/tenancy';\n");
    const result = run({
      [POLICY_PATH]: fixturePolicy({ collisionBytes: content }),
      [PLUGIN_PATH]: 'export {};\n',
      [COLLISION_PATH]: content,
      [COLLISION_TARGET]: 'export const computeFootprintTiles = () => [];\n',
    });
    assert.deepEqual(issueCodes(result), ['SOURCE_IMPORT_FORBIDDEN']);
  });
});

describe('checkSourceBoundaries file pins', () => {
  it('reports a missing or drifted plugin pin', () => {
    const missing = run({ [POLICY_PATH]: fixturePolicy({}) });
    assert.deepEqual(issueCodes(missing), ['SOURCE_PIN_MISSING']);
    assert.equal(missing.issues[0].path, PLUGIN_PATH);
    const drifted = run({
      [POLICY_PATH]: fixturePolicy({}),
      [PLUGIN_PATH]: 'export const changed = true;\n',
    });
    assert.deepEqual(issueCodes(drifted), ['SOURCE_PIN_MISMATCH']);
  });

  it('grants no import rights through an intact plugin pin', () => {
    const plugin = `export const loaders = 1;\nimport cached from '@meetropolis/tenancy';\n`;
    const result = run({
      [POLICY_PATH]: fixturePolicy({ pluginBytes: plugin }),
      [PLUGIN_PATH]: plugin,
    });
    assert.deepEqual(issueCodes(result), ['SOURCE_IMPORT_FORBIDDEN']);
  });
});

describe('checkSourceBoundaries syntax and infrastructure', () => {
  it('keeps syntax failures as parse issues', () => {
    const result = run({
      [POLICY_PATH]: fixturePolicy({}),
      [PLUGIN_PATH]: 'export {};\n',
      'apps/server/src/broken.ts': 'const = ;\n',
    });
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].code, 'SOURCE_PARSE_FAILED');
    assert.equal(result.issues[0].path, 'apps/server/src/broken.ts');
    assert.equal(result.issues[0].severity, 'error');
    assert.deepEqual(
      Object.keys(result.issues[0]).filter((key) => !['severity', 'code', 'path', 'line', 'column'].includes(key)),
      [],
    );
  });

  it('fails infrastructure errors constantly without markers', () => {
    assertInvalid(() => checkSourceBoundaries(null), []);
    assertInvalid(() => checkSourceBoundaries({ files: {} }), []);
    assertInvalid(() => checkSourceBoundaries({ files: new Map() }), []);
    assertInvalid(() => run({ [POLICY_PATH]: Buffer.from([0xff, 0xfe]) }), []);
    assertInvalid(
      () =>
        run({
          [POLICY_PATH]: fixturePolicy({}),
          [PLUGIN_PATH]: 'export {};\n',
          'apps/server/src/binary.ts': Buffer.from([0xff, 0xfe]),
        }),
      [],
    );
    assertInvalid(() => run({ [POLICY_PATH]: fixturePolicy({}), '/absolute.ts': 'x' }), ['/absolute.ts']);
    assertInvalid(() => run({ [POLICY_PATH]: fixturePolicy({}), 'C:relative.ts': 'x' }), ['C:relative.ts']);
    assertInvalid(
      () =>
        run({
          [POLICY_PATH]: fixturePolicy({}),
          [PLUGIN_PATH]: 'export {};\n',
          'apps/server/src/other.ts': 42,
        }),
      [],
    );
    assertInvalid(
      () => checkSourceBoundaries({ files: toMap({ [POLICY_PATH]: 'MARKER-BAD-MAP' }) }),
      ['MARKER-BAD-MAP'],
    );
  });
});

describe('checkSourceBoundaries ordering and input', () => {
  it('sorts records and issues deterministically and keeps duplicates', () => {
    const source = `${loaderSource('@meetropolis/tenancy')}export async function loadAgain() {\n  return import('@meetropolis/tenancy');\n}\n`;
    const result = run({
      [POLICY_PATH]: fixturePolicy({}),
      [PLUGIN_PATH]: 'export {};\n',
      'zz/b.ts': source,
      'aa/a.ts': source,
    });
    assert.deepEqual(
      result.issues.map((issue) => issue.path),
      ['aa/a.ts', 'aa/a.ts', 'zz/b.ts', 'zz/b.ts'],
    );
    for (const issue of result.issues) {
      assert.deepEqual(
        Object.keys(issue).filter((key) => !['severity', 'code', 'path', 'line', 'column'].includes(key)),
        [],
      );
    }
    assert.deepEqual(
      result.records.map((record) => record.path),
      ['aa/a.ts', 'aa/a.ts', 'zz/b.ts', 'zz/b.ts'],
    );
  });

  it('leaves the input map untouched', () => {
    const files = toMap({
      [POLICY_PATH]: fixturePolicy({}),
      [PLUGIN_PATH]: 'export {};\n',
      'apps/server/src/other.ts': loaderSource('@meetropolis/tenancy'),
    });
    const before = Array.from(files.entries()).map(([name, bytes]) => [name, bytes.length]);
    checkSourceBoundaries({ files });
    checkSourceBoundaries({ files });
    assert.deepEqual(
      Array.from(files.entries()).map(([name, bytes]) => [name, bytes.length]),
      before,
    );
    assert.deepEqual(Array.from(files.keys()), [POLICY_PATH, PLUGIN_PATH, 'apps/server/src/other.ts']);
  });
});

function manifestPolicy(pluginContent) {
  return policyBytes((policy) => {
    policy.sourceImports.pinnedFiles = [
      {
        path: PLUGIN_PATH,
        sha256: sha256Hex(Buffer.from(pluginContent, 'utf8')),
        reason: 'Fixture plugin pin.',
      },
    ];
    policy.sourceImports.pinnedDynamicImports = [];
  });
}

function manifestEntries(extra, pluginContent = 'export {};\n') {
  return { [POLICY_PATH]: manifestPolicy(pluginContent), [PLUGIN_PATH]: pluginContent, ...extra };
}

describe('checkSourceBoundaries manifests and lockfiles', () => {
  it('reports a protected dependency in package.json', () => {
    const content = '{\n  "name": "fixture",\n  "dependencies": {\n    "@signalyr/sdk-node": "1.0.0"\n  }\n}\n';
    const result = run(manifestEntries({ 'package.json': content }));
    assert.deepEqual(issueCodes(result), ['SOURCE_MANIFEST_PRIVATE']);
    assert.equal(result.issues[0].path, 'package.json');
    assert.equal(result.issues[0].severity, 'error');
    assert.equal(result.issues[0].line, 4);
    assert.deepEqual(Object.keys(result.issues[0]).sort(), ['code', 'line', 'path', 'severity']);
  });

  it('reports a protected devDependency in package.json', () => {
    const content = '{\n  "name": "fixture",\n  "devDependencies": {\n    "@meetropolis/tenancy": "*"\n  }\n}\n';
    const result = run(manifestEntries({ 'package.json': content }));
    assert.deepEqual(issueCodes(result), ['SOURCE_MANIFEST_PRIVATE']);
    assert.equal(result.issues[0].path, 'package.json');
    assert.equal(result.issues[0].line, 4);
  });

  it('reports a protected alias target in package.json', () => {
    const content =
      '{\n  "name": "fixture",\n  "dependencies": {\n    "safe-name": "npm:@meetropolis/enterprise-web@1.0.0"\n  }\n}\n';
    const result = run(manifestEntries({ 'package.json': content }));
    assert.deepEqual(issueCodes(result), ['SOURCE_MANIFEST_PRIVATE']);
    assert.equal(result.issues[0].path, 'package.json');
    assert.equal(result.issues[0].line, 4);
  });

  it('leaves public dependencies in package.json alone', () => {
    const content =
      '{\n  "name": "fixture",\n  "dependencies": {\n    "left-pad": "1.0.0",\n    "@meetropolis/shared": "1.0.0",\n    "@meetropolis/web": "1.0.0"\n  }\n}\n';
    const result = run(manifestEntries({ 'package.json': content }));
    assert.deepEqual(result.issues, []);
  });

  it('reports a protected optionalDependency in a nested package.json', () => {
    const content =
      '{\n  "name": "nested-fixture",\n  "optionalDependencies": {\n    "@meetropolis/tenancy": "*"\n  }\n}\n';
    const result = run(manifestEntries({ 'apps/x/package.json': content }));
    assert.deepEqual(issueCodes(result), ['SOURCE_MANIFEST_PRIVATE']);
    assert.equal(result.issues[0].path, 'apps/x/package.json');
    assert.equal(result.issues[0].line, 4);
  });

  it('reports a protected package entry in package-lock.json', () => {
    const content =
      '{\n  "name": "fixture",\n  "packages": {\n    "": {},\n    "node_modules/@signalyr/sdk-browser": {\n      "version": "1.0.0"\n    }\n  }\n}\n';
    const result = run(manifestEntries({ 'package-lock.json': content }));
    assert.deepEqual(issueCodes(result), ['SOURCE_LOCK_PRIVATE']);
    assert.equal(result.issues[0].path, 'package-lock.json');
    assert.equal(result.issues[0].line, 5);
  });

  it('reports a protected entry dependency in package-lock.json', () => {
    const content =
      '{\n  "packages": {\n    "apps/web": {\n      "dependencies": {\n        "@meetropolis/brand-web": "*"\n      }\n    }\n  }\n}\n';
    const result = run(manifestEntries({ 'package-lock.json': content }));
    assert.deepEqual(issueCodes(result), ['SOURCE_LOCK_PRIVATE']);
    assert.equal(result.issues[0].path, 'package-lock.json');
    assert.equal(result.issues[0].line, 5);
  });

  it('leaves public entries in package-lock.json alone', () => {
    const content =
      '{\n  "packages": {\n    "": { "name": "fixture" },\n    "node_modules/left-pad": { "version": "1.0.0" },\n    "apps/web": { "dependencies": { "left-pad": "*" } }\n  }\n}\n';
    const result = run(manifestEntries({ 'package-lock.json': content }));
    assert.deepEqual(result.issues, []);
  });

  it('fails invalid package.json data constantly', () => {
    assertInvalid(() => run(manifestEntries({ 'package.json': '{ not json' })), []);
    assertInvalid(() => run(manifestEntries({ 'package.json': '[1, 2]' })), []);
  });

  it('finds no manifest or lockfile issues in the real manifests', () => {
    const manifestPaths = [
      'package.json',
      'package-lock.json',
      'packages/shared/package.json',
      'tools/asset-lab/package.json',
      'tools/asset-lab/package-lock.json',
    ];
    for (const dir of fs.readdirSync(path.join(REPO_ROOT, 'apps'))) {
      const candidate = path.join('apps', dir, 'package.json');
      if (fs.existsSync(path.join(REPO_ROOT, candidate))) manifestPaths.push(candidate);
    }
    const entries = { [POLICY_PATH]: fs.readFileSync(path.join(REPO_ROOT, POLICY_PATH)) };
    for (const name of manifestPaths) entries[name] = fs.readFileSync(path.join(REPO_ROOT, name));
    const result = run(entries);
    const codes = issueCodes(result).filter(
      (code) => code === 'SOURCE_MANIFEST_PRIVATE' || code === 'SOURCE_LOCK_PRIVATE',
    );
    assert.deepEqual(codes, []);
  });
});
