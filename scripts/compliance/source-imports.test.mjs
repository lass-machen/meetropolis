// Tests for the syntactic collection of source imports.
//
// Every fixture is a self written source string that is parsed only and
// never executed. No mock and no fallback parser is involved: the tests
// always use the real Babel parser through the runtime loader.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectSourceImports } from './source-imports.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_MODULE = 'source-imports.mjs';
const RUNTIME_MODULE = 'parser-runtime.mjs';
const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';
const RECORD_KEYS = ['argumentKind', 'column', 'kind', 'line', 'path', 'specifier', 'typeOnly'];

// One based line and column of the first occurrence of a marker.
const positionOf = (source, marker) => {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `marker not found: ${marker}`);
  const before = source.slice(0, index);
  return { line: before.split('\n').length, column: index - before.lastIndexOf('\n') };
};

// Expected record of a construct that starts at the given marker.
const recordAt = (source, filePath, marker, kind, specifier, typeOnly, argumentKind) => {
  const { line, column } = positionOf(source, marker);
  return { path: filePath, kind, specifier, typeOnly, line, column, argumentKind };
};

describe('collectSourceImports', () => {
  it('records every module reference shape without resolving it', () => {
    const filePath = 'src/example.ts';
    const source = [
      "import defaultExport from './default.js';",
      "import { named } from './named.js';",
      "import './side-effect.js';",
      "export { value } from './reexport.js';",
      "export * from './star.js';",
      "const dynamic = import('./dynamic.js');",
      "const required = require('./required.js');",
      "const resolved = require.resolve('./resolved.js');",
      "const moduleRequired = module.require('./module.js');",
      "const metaResolved = import.meta.resolve('./meta.js');",
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(records, [
      recordAt(source, filePath, 'import defaultExport', 'import', './default.js', false, 'literal'),
      recordAt(source, filePath, 'import { named }', 'import', './named.js', false, 'literal'),
      recordAt(source, filePath, "import './side-effect.js'", 'import', './side-effect.js', false, 'literal'),
      recordAt(source, filePath, 'export { value }', 'export', './reexport.js', false, 'literal'),
      recordAt(source, filePath, 'export * from', 'export', './star.js', false, 'literal'),
      recordAt(source, filePath, "import('./dynamic.js')", 'dynamic-import', './dynamic.js', false, 'literal'),
      recordAt(source, filePath, "require('./required.js')", 'require', './required.js', false, 'literal'),
      recordAt(
        source,
        filePath,
        "require.resolve('./resolved.js')",
        'require-resolve',
        './resolved.js',
        false,
        'literal',
      ),
      recordAt(source, filePath, "module.require('./module.js')", 'module-require', './module.js', false, 'literal'),
      recordAt(
        source,
        filePath,
        "import.meta.resolve('./meta.js')",
        'import-meta-resolve',
        './meta.js',
        false,
        'literal',
      ),
    ]);
    assert.deepEqual(Object.keys(records[0]).sort(), RECORD_KEYS);
  });

  it('decodes an escaped specifier', () => {
    const filePath = 'src/greeting.ts';
    const source = "import greeting from './\\u0067reeting';\nconst later = import(`./\\u0067reeting`);\n";

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.equal(records.length, 2);
    assert.equal(records[0].specifier, './greeting');
    assert.equal(records[1].specifier, './greeting');
    assert.equal(records[1].argumentKind, 'template');
  });

  it('classifies the argument of a dynamic import', () => {
    const filePath = 'src/dynamic.ts';
    const source = [
      "const literal = import('./literal.js');",
      'const template = import(`./template.js`);',
      'const dynamicTemplate = import(`./dynamic-${name}.js`);',
      'const identifier = import(specifier);',
      'const expression = import(buildSpecifier());',
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(
      records.map((record) => [record.kind, record.specifier, record.argumentKind]),
      [
        ['dynamic-import', './literal.js', 'literal'],
        ['dynamic-import', './template.js', 'template'],
        ['dynamic-import', null, 'template'],
        ['dynamic-import', null, 'identifier'],
        ['dynamic-import', null, 'expression'],
      ],
    );
  });

  it('classifies the argument of a require call', () => {
    const filePath = 'src/require.cjs';
    const source = [
      "const literal = require('./literal.js');",
      'const template = require(`./template.js`);',
      'const identifier = require(specifier);',
      'const expression = require(buildSpecifier());',
      'const missing = require();',
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(
      records.map((record) => [record.kind, record.specifier, record.argumentKind]),
      [
        ['require', './literal.js', 'literal'],
        ['require', './template.js', 'template'],
        ['require', null, 'identifier'],
        ['require', null, 'expression'],
        ['require', null, 'missing'],
      ],
    );
  });

  it('recognizes computed and optional member calls', () => {
    const filePath = 'src/optional.ts';
    const source = [
      "const computed = require['resolve']('./computed.js');",
      "const optional = require?.resolve('./optional.js');",
      "const optionalMember = module?.require('./optional-member.js');",
      "const optionalCall = require.resolve?.('./optional-call.js');",
      "const optionalMeta = import.meta?.resolve('./optional-meta.js');",
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(
      records.map((record) => [record.kind, record.specifier]),
      [
        ['require-resolve', './computed.js'],
        ['require-resolve', './optional.js'],
        ['module-require', './optional-member.js'],
        ['require-resolve', './optional-call.js'],
        ['import-meta-resolve', './optional-meta.js'],
      ],
    );
  });

  it('ignores calls that are no known module reference', () => {
    const filePath = 'src/unrelated.ts';
    const source = [
      "const other = object.require('./object.js');",
      "const method = other.resolve('./other.js');",
      "const local = helper('./helper.js');",
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(records, []);
  });

  it('marks type only imports and re-exports', () => {
    const filePath = 'src/types.ts';
    const source = [
      "import type { OnlyType } from './type-only.js';",
      "import { type InlineType } from './inline-type.js';",
      "import { type MixedType, runtimeValue } from './mixed.js';",
      "import './side-effect.js';",
      "export type { ExportedType } from './export-type.js';",
      "export { type InlineExport } from './export-inline.js';",
      "export { type MixedExport, runtimeExport } from './export-mixed.js';",
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(
      records.map((record) => [record.kind, record.specifier, record.typeOnly]),
      [
        ['import', './type-only.js', true],
        ['import', './inline-type.js', true],
        ['import', './mixed.js', false],
        ['import', './side-effect.js', false],
        ['export', './export-type.js', true],
        ['export', './export-inline.js', true],
        ['export', './export-mixed.js', false],
      ],
    );
  });

  it('records one entry for a TypeScript import equals', () => {
    const filePath = 'src/equals.ts';
    const source = [
      "import alias = require('./equals.js');",
      "import type typeAlias = require('./type-equals.js');",
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.equal(records.length, 2);
    assert.deepEqual(
      records.map((record) => [record.kind, record.specifier, record.typeOnly, record.argumentKind]),
      [
        ['ts-import-equals', './equals.js', false, 'literal'],
        ['ts-import-equals', './type-equals.js', true, 'literal'],
      ],
    );
  });

  it('records a TypeScript import type as type only', () => {
    const filePath = 'src/import-type.ts';
    const source = "type Imported = import('./type.js').Imported;\n";

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(records, [
      recordAt(source, filePath, "import('./type.js')", 'ts-import-type', './type.js', true, 'literal'),
    ]);
  });

  it('parses TypeScript with decorators and JSX', () => {
    const filePath = 'src/root.tsx';
    const source = [
      "import { Component } from '@angular/core';",
      '',
      "@Component({ selector: 'app-root' })",
      'export class RootComponent {',
      '  render(): unknown {',
      '    return <main>hello</main>;',
      '  }',
      '}',
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(records, [
      recordAt(source, filePath, 'import { Component }', 'import', '@angular/core', false, 'literal'),
    ]);
  });

  it('parses JSX in a jsx file', () => {
    const filePath = 'src/widget.jsx';
    const source = ["import { useState } from 'react';", 'export const Widget = () => <div />;'].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.equal(records.length, 1);
    assert.equal(records[0].specifier, 'react');
  });

  it('creates no record for comments, strings and regular expressions', () => {
    const filePath = 'src/text.ts';
    const source = [
      "// import { commented } from './comment.js';",
      '/* import defaultCommented from "./block.js"; */',
      'const text = \'import { quoted } from "./string.js";\';',
      'const pattern = /import\\s+matched\\s+from/;',
      'const template = `import { templated } from "./template.js";`;',
      'const nested = "require(\'./nested.js\')";',
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(records, []);
  });

  it('sorts the records by position and keeps repeated imports', () => {
    const filePath = 'src/sorted.ts';
    const source = ["import './same.js';", "const late = import('./late.js');", "import './same.js';"].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(
      records.map((record) => [record.line, record.kind, record.specifier]),
      [
        [1, 'import', './same.js'],
        [2, 'dynamic-import', './late.js'],
        [3, 'import', './same.js'],
      ],
    );
  });

  it('reports a syntax error as a finding without raw values', () => {
    const filePath = 'src/broken.ts';
    const source = 'const broken = ;\n';

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(records, []);
    assert.equal(issues.length, 1);
    const { line, column } = positionOf(source, ';');
    assert.deepEqual(issues[0], {
      severity: 'error',
      code: 'SOURCE_PARSE_FAILED',
      path: filePath,
      line,
      column,
    });
  });

  it('keeps the marker of a broken source out of the issue', () => {
    const filePath = 'src/marker.ts';
    const source = "const value = 'UNFINISHED_MARKER_STRING\n";

    const { issues } = collectSourceImports({ path: filePath, source });

    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, 'SOURCE_PARSE_FAILED');
    const serialized = JSON.stringify(issues);
    assert.ok(!serialized.includes('UNFINISHED_MARKER_STRING'));
    assert.ok(!serialized.includes('Unterminated'));
  });

  it('keeps a truncated source a syntax finding in a module and a declaration file', () => {
    const source = "import { value from './truncated.js';\n";

    for (const filePath of ['src/truncated.ts', 'src/truncated.d.ts']) {
      const { records, issues } = collectSourceImports({ path: filePath, source });
      assert.deepEqual(records, []);
      assert.equal(issues.length, 1);
      assert.equal(issues[0].code, 'SOURCE_PARSE_FAILED');
      assert.equal(issues[0].path, filePath);
    }
  });

  it('parses an ambient named export in a declaration file completely', () => {
    const filePath = 'src/types.d.ts';
    const source = [
      "import { before } from './before.js';",
      'export { AmbientType };',
      "import { between } from './between.js';",
      "export { after } from './after.js';",
      "import { last } from './last.js';",
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(
      records.map((record) => [record.kind, record.specifier]),
      [
        ['import', './before.js'],
        ['import', './between.js'],
        ['export', './after.js'],
        ['import', './last.js'],
      ],
    );
  });

  it('keeps an undeclared export in a normal module a syntax finding', () => {
    const filePath = 'src/types.ts';
    const source = [
      "import { before } from './before.js';",
      'export { AmbientType };',
      "import { between } from './between.js';",
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(records, []);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, 'SOURCE_PARSE_FAILED');
    assert.equal(issues[0].path, filePath);
  });

  it('parses declaration function bodies and records their module calls', () => {
    const filePath = 'src/api.d.ts';
    const source = [
      "import { readFileSync } from 'node:fs';",
      '',
      'export declare function ambient(): void;',
      '',
      'export function withBody(): void {',
      "  readFileSync('file.txt', 'utf8');",
      "  require('./legacy.js');",
      '}',
    ].join('\n');

    const { records, issues } = collectSourceImports({ path: filePath, source });

    assert.deepEqual(issues, []);
    assert.deepEqual(
      records.map((record) => [record.kind, record.specifier]),
      [
        ['import', 'node:fs'],
        ['require', './legacy.js'],
      ],
    );
  });

  it('rejects invalid input with a constant error', () => {
    const invalidCalls = [
      () => collectSourceImports(),
      () => collectSourceImports({}),
      () => collectSourceImports(null),
      () => collectSourceImports([]),
      () => collectSourceImports({ path: 'src/example.txt', source: '' }),
      () => collectSourceImports({ path: 'src/example', source: '' }),
      () => collectSourceImports({ path: '/absolute/example.ts', source: '' }),
      () => collectSourceImports({ path: '../outside.ts', source: '' }),
      () => collectSourceImports({ path: 'src/../example.ts', source: '' }),
      () => collectSourceImports({ path: './example.ts', source: '' }),
      () => collectSourceImports({ path: '', source: '' }),
      () => collectSourceImports({ path: 42, source: '' }),
      () => collectSourceImports({ path: 'src/example.ts' }),
      () => collectSourceImports({ path: 'src/example.ts', source: null }),
      () => collectSourceImports({ path: 'src/example.ts', source: 42 }),
      () => collectSourceImports({ path: 'src/example.ts', source: Object('text') }),
    ];

    for (const call of invalidCalls) {
      assert.throws(call, (error) => {
        assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
        assert.equal(error.message, DATA_INVALID_MESSAGE);
        return true;
      });
    }
  });

  it('keeps raw values out of the invalid input error', () => {
    assert.throws(
      () => collectSourceImports({ path: 'src/SECRET_PATH_MARKER.txt', source: 'SECRET_SOURCE_MARKER' }),
      (error) => {
        assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
        assert.ok(!error.message.includes('SECRET_PATH_MARKER'));
        assert.ok(!error.message.includes('SECRET_SOURCE_MARKER'));
        return true;
      },
    );
  });

  it('reports a missing parser as an infrastructure error and not as a syntax finding', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetropolis-source-imports-fixture-'));
    try {
      fs.copyFileSync(path.join(HERE, SOURCE_MODULE), path.join(fixtureDir, SOURCE_MODULE));
      fs.copyFileSync(path.join(HERE, RUNTIME_MODULE), path.join(fixtureDir, RUNTIME_MODULE));
      const runnerPath = path.join(fixtureDir, 'run-source-imports.mjs');
      fs.writeFileSync(
        runnerPath,
        `import { collectSourceImports } from './${SOURCE_MODULE}';\n` +
          'try {\n' +
          "  collectSourceImports({ path: 'src/example.ts', source: 'const a = 1;' });\n" +
          "  process.stdout.write('unexpected success');\n" +
          '  process.exitCode = 3;\n' +
          '} catch (error) {\n' +
          '  process.stdout.write(JSON.stringify({ code: error.code, exitCode: error.exitCode }));\n' +
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
      assert.deepEqual(JSON.parse(child.stdout), {
        code: 'COMPLIANCE_PARSER_UNAVAILABLE',
        exitCode: 2,
      });
      assert.ok(!child.stdout.includes('SOURCE_PARSE_FAILED'));
      assert.ok(!child.stderr.includes(fixtureDir));
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
