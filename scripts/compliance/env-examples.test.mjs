// Tests for the strict env example check.
// The fixtures are synthetic bytes built in memory: no real template values
// are copied, every Map uses real Buffers and the module under test is the
// real file. Only this test file touches the file system to read the real
// policy as a fixture base and to stage isolated child runners in temp dirs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEnvExamples } from './env-examples.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const POLICY_PATH = 'compliance/policy.json';
const DATA_INVALID_MESSAGE = 'The compliance data is invalid.';
const ENV_FAILED_MESSAGE = 'The check of the example templates failed.';
const MODULE_PATH = fileURLToPath(new URL('./env-examples.mjs', import.meta.url));
const CHILD_PREFIX = 'meetropolis-env-examples-';
// Synthetic policy with one credential and one address key for generic tests.
function synthExamples(policy) {
  policy.envExamples = {
    credentialKeys: ['SYNTH_EXAMPLE_CRED'],
    addressKeys: ['SYNTH_EXAMPLE_ADDR'],
  };
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
function run(entries, mutate) {
  const files = toMap(entries);
  files.set(POLICY_PATH, policyBytes(mutate));
  return checkEnvExamples({ files });
}
function runSynth(entries) {
  return run(entries, synthExamples);
}
function codesOf(result) {
  return result.issues.map((issue) => issue.code);
}
function assertInvalid(call, markers = []) {
  assert.throws(call, (error) => {
    assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
    assert.equal(error.exitCode, 2);
    assert.equal(error.message, DATA_INVALID_MESSAGE);
    for (const marker of markers) {
      if (marker.length === 0) continue;
      assert.ok(!error.message.includes(marker));
    }
    return true;
  });
}
describe('checkEnvExamples: line grammar and records', () => {
  it('reports zero records for an empty file', () => {
    const result = runSynth({ '.env.example': Buffer.alloc(0) });
    assert.deepEqual(result.records, []);
    assert.deepEqual(result.issues, []);
  });
  it('counts one record per physical line without a phantom trailing line', () => {
    const one = runSynth({ '.env.example': 'SYNTH_A=one\n' });
    assert.equal(one.records.length, 1);
    const two = runSynth({ '.env.example': 'SYNTH_A=one\nSYNTH_B=two\n' });
    assert.equal(two.records.length, 2);
    const noNewline = runSynth({ '.env.example': 'SYNTH_A=one\nSYNTH_B=two' });
    assert.equal(noNewline.records.length, 2);
    const singleNewline = runSynth({ '.env.example': '\n' });
    assert.equal(singleNewline.records.length, 1);
    assert.equal(singleNewline.records[0].kind, 'empty');
  });
  it('accepts LF and CRLF endings and rejects a lone CR', () => {
    const crlf = runSynth({ '.env.example': 'SYNTH_A=one\r\nSYNTH_B=two\r\n' });
    assert.equal(crlf.records.length, 2);
    assert.ok(crlf.records.every((record) => record.kind === 'assignment'));
    const lone = runSynth({ '.env.example': Buffer.from('SYNTH_A=one\rSYNTH_B=two', 'utf8') });
    assert.ok(lone.records.some((record) => record.kind === 'unsupported'));
    assert.ok(codesOf(lone).includes('ENV_EXAMPLE_SYNTAX_UNSUPPORTED'));
  });
  it('flags invalid UTF-8 and a BOM without stripping it', () => {
    const invalid = runSynth({ '.env.example': Buffer.from([0x53, 0xff, 0x0a]) });
    assert.equal(invalid.records[0].kind, 'unsupported');
    assert.ok(codesOf(invalid).includes('ENV_EXAMPLE_SYNTAX_UNSUPPORTED'));
    const bom = runSynth({
      '.env.example': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('SYNTH_A=one\n', 'utf8')]),
    });
    assert.equal(bom.records[0].kind, 'unsupported');
    assert.ok(codesOf(bom).includes('ENV_EXAMPLE_SYNTAX_UNSUPPORTED'));
  });
  it('treats horizontal whitespace as empty and rejects control characters', () => {
    const blank = runSynth({ '.env.example': '   \n\t\n' });
    assert.deepEqual(
      blank.records.map((record) => record.kind),
      ['empty', 'empty'],
    );
    assert.deepEqual(blank.issues, []);
    const control = runSynth({ '.env.example': 'SYNTH_A=one\x01\n' });
    assert.equal(control.records[0].kind, 'unsupported');
    assert.ok(codesOf(control).includes('ENV_EXAMPLE_SYNTAX_UNSUPPORTED'));
  });
  it('rejects indentation, spaces around the separator and export prefixes', () => {
    for (const content of [
      ' SYNTH_A=one\n',
      'SYNTH_A =one\n',
      'SYNTH_A= one\n',
      'export SYNTH_A=one\n',
      '1SYNTH=one\n',
    ]) {
      const result = runSynth({ '.env.example': content });
      assert.equal(result.records[0].kind, 'unsupported', content);
      assert.ok(codesOf(result).includes('ENV_EXAMPLE_SYNTAX_UNSUPPORTED'));
    }
    const ok = runSynth({ '.env.example': '_SYNTH_OK9=one\n' });
    assert.equal(ok.records[0].kind, 'assignment');
  });
  it('validates unquoted values without hashes quotes backslashes or edge spaces', () => {
    const plain = runSynth({ '.env.example': 'SYNTH_A=hello world\n' });
    assert.equal(plain.records[0].kind, 'assignment');
    for (const content of [
      'SYNTH_A=hello#world\n',
      "SYNTH_A=hello'world\n",
      'SYNTH_A=hello"world\n',
      'SYNTH_A=hello`world\n',
      'SYNTH_A=hello\\world\n',
      'SYNTH_A=hello \n',
      'SYNTH_A= hello\n',
      'SYNTH_A=one\two\n',
    ]) {
      const result = runSynth({ '.env.example': content });
      assert.equal(result.records[0].kind, 'unsupported', content);
    }
  });
  it('validates quoted values as one exact matching pair', () => {
    const doubleQuoted = runSynth({ '.env.example': 'SYNTH_A="hello # world"\n' });
    assert.equal(doubleQuoted.records[0].kind, 'assignment');
    const singleQuoted = runSynth({ '.env.example': "SYNTH_A='a\"b'\n" });
    assert.equal(singleQuoted.records[0].kind, 'assignment');
    const emptyQuoted = runSynth({ '.env.example': 'SYNTH_A=""\n' });
    assert.equal(emptyQuoted.records[0].kind, 'assignment');
    for (const content of [
      'SYNTH_A="a"b"\n',
      'SYNTH_A="a\\b"\n',
      'SYNTH_A="a" \n',
      'SYNTH_A="a"x\n',
      'SYNTH_A="a\'\n',
      'SYNTH_A="a\n',
    ]) {
      const result = runSynth({ '.env.example': content });
      assert.equal(result.records[0].kind, 'unsupported', content);
    }
  });
  it('separates prose comments from commented assignments fail closed', () => {
    const prose = runSynth({ '.env.example': '# synthetic prose line\n' });
    assert.equal(prose.records[0].kind, 'comment');
    const emptyComment = runSynth({ '.env.example': '   #   \n' });
    assert.equal(emptyComment.records[0].kind, 'comment');
    const commented = runSynth({ '.env.example': '# SYNTH_A=one\n' });
    assert.equal(commented.records[0].kind, 'commented_assignment');
    const badProse = runSynth({ '.env.example': '# some prose with = and bad syntax here =\n' });
    assert.equal(badProse.records[0].kind, 'unsupported_commented_assignment');
    assert.ok(codesOf(badProse).includes('ENV_EXAMPLE_SYNTAX_UNSUPPORTED'));
  });
  it('counts duplicates separately for active and commented assignments', () => {
    const active = runSynth({ '.env.example': 'SYNTH_A=one\nSYNTH_A=two\n' });
    assert.ok(codesOf(active).includes('ENV_EXAMPLE_DUPLICATE_KEY'));
    assert.equal(active.issues.filter((issue) => issue.code === 'ENV_EXAMPLE_DUPLICATE_KEY').length, 1);
    const mixed = runSynth({ '.env.example': 'SYNTH_A=one\n# SYNTH_A=two\n' });
    assert.ok(!codesOf(mixed).includes('ENV_EXAMPLE_DUPLICATE_KEY'));
    const commented = runSynth({ '.env.example': '# SYNTH_A=one\n# SYNTH_A=two\n' });
    assert.ok(codesOf(commented).includes('ENV_EXAMPLE_DUPLICATE_KEY'));
  });
  it('keeps a valid duplicate under content review and syntax without content', () => {
    const duplicate = runSynth({ '.env.example': 'SYNTH_OTHER=one\nSYNTH_OTHER=two\n' });
    const secondLine = duplicate.issues.filter((issue) => issue.line === 2).map((issue) => issue.code);
    assert.ok(secondLine.includes('ENV_EXAMPLE_DUPLICATE_KEY'));
    assert.ok(secondLine.some((code) => code.endsWith('_REVIEW_REQUIRED')));
    const syntax = runSynth({ '.env.example': 'SYNTH_A=one\nSYNTH_A=bad # value\n' });
    const syntaxLine = syntax.issues.filter((issue) => issue.line === 2);
    assert.equal(syntaxLine.length, 1);
    assert.equal(syntaxLine[0].code, 'ENV_EXAMPLE_SYNTAX_UNSUPPORTED');
  });
  it('exposes only safe record fields and sorts records deterministically', () => {
    const result = runSynth({ 'b/.env.example': 'SYNTH_B=two\n', 'a/.env.example': '# note\nSYNTH_A=one\n' });
    for (const record of result.records) {
      assert.deepEqual(Object.keys(record).sort(), ['kind', 'line', 'path']);
    }
    assert.deepEqual(
      result.records.map((record) => record.path),
      ['a/.env.example', 'a/.env.example', 'b/.env.example'],
    );
    const again = runSynth({ 'b/.env.example': 'SYNTH_B=two\n', 'a/.env.example': '# note\nSYNTH_A=one\n' });
    assert.deepEqual(again, result);
  });
});
describe('checkEnvExamples: content review', () => {
  it('prioritises URL userinfo over keys and addresses', () => {
    const userinfo = runSynth({
      '.env.example': 'SYNTH_PLAIN_URL=https://synth-user:synth-pass@synth-host.example/db\n',
    });
    assert.ok(codesOf(userinfo).includes('ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED'));
    const userOnly = runSynth({ '.env.example': 'SYNTH_PLAIN_URL=https://synth-user@synth-host.example/db\n' });
    assert.ok(codesOf(userOnly).includes('ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED'));
  });
  it('flags exact credential keys and address keys with synthetic values', () => {
    const cred = run({ '.env.example': 'POSTGRES_PASSWORD=synth-placeholder-01\n' }, undefined);
    assert.ok(codesOf(cred).includes('ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED'));
    const addr = run({ '.env.example': 'HOST_IP=synth-placeholder-02\n' }, undefined);
    assert.ok(codesOf(addr).includes('ENV_EXAMPLE_ADDRESS_REVIEW_REQUIRED'));
  });
  it('flags URL hostnames as addresses and keeps invalid URLs general', () => {
    const url = runSynth({ '.env.example': 'SYNTH_PLAIN_URL=https://synth-host.example/path\n' });
    assert.ok(codesOf(url).includes('ENV_EXAMPLE_ADDRESS_REVIEW_REQUIRED'));
    const invalid = runSynth({ '.env.example': 'SYNTH_PLAIN=::: not a url :::\n' });
    assert.ok(codesOf(invalid).includes('ENV_EXAMPLE_VALUE_REVIEW_REQUIRED'));
  });
  it('leaves unknown plain values as general review without substrings', () => {
    const plain = runSynth({ '.env.example': 'SYNTH_UNKNOWN=synth-plain-value-01\n' });
    assert.ok(codesOf(plain).includes('ENV_EXAMPLE_VALUE_REVIEW_REQUIRED'));
    const timeout = run({ '.env.example': 'POSTGRES_PASSWORD_TIMEOUT=synth-plain-value-02\n' }, undefined);
    assert.ok(codesOf(timeout).includes('ENV_EXAMPLE_VALUE_REVIEW_REQUIRED'));
    assert.ok(!codesOf(timeout).includes('ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED'));
  });
  it('emits no content issues for empty values', () => {
    for (const content of ['SYNTH_EMPTY=\n', 'SYNTH_EMPTY=""\n', "SYNTH_EMPTY=''\n"]) {
      const result = runSynth({ '.env.example': content });
      assert.equal(result.records[0].kind, 'assignment', content);
      assert.deepEqual(result.issues, []);
    }
    const emptyCred = run({ '.env.example': 'POSTGRES_PASSWORD=\n' }, undefined);
    assert.deepEqual(emptyCred.issues, []);
  });
});
describe('checkEnvExamples: prose and file selection', () => {
  it('defers prose scans once per file at the first prose line', () => {
    const result = runSynth({ '.env.example': '# first synthetic note\n# second synthetic note\nSYNTH_A=one\n' });
    const infos = result.issues.filter((issue) => issue.code === 'ENV_EXAMPLE_PROSE_SECRET_SCAN_DEFERRED');
    assert.equal(infos.length, 1);
    assert.equal(infos[0].line, 1);
    assert.equal(infos[0].severity, 'info');
    const emptyOnly = runSynth({ '.env.example': '#\n#   \nSYNTH_A=one\n' });
    assert.ok(!codesOf(emptyOnly).includes('ENV_EXAMPLE_PROSE_SECRET_SCAN_DEFERRED'));
  });
  it('selects only case sensitive example basenames like the git reader', () => {
    const nested = runSynth({ 'config/.env.production.example': 'SYNTH_A=one\n' });
    assert.equal(nested.records.length, 1);
    const upper = runSynth({ 'config/.ENV.EXAMPLE': 'SYNTH_A=one\n' });
    assert.deepEqual(upper.records, []);
    assert.ok(codesOf(upper).includes('ENV_FILE_TRACKED'));
  });
  it('reports real dotenv names without decoding their bytes', () => {
    const invalidBytes = Buffer.from([0xff, 0xfe, 0x0a]);
    for (const name of ['.env', '.env.local', 'name.env', 'name.env.local']) {
      const result = runSynth({ [name]: invalidBytes });
      assert.deepEqual(result.records, [], name);
      assert.equal(result.issues.length, 1);
      assert.equal(result.issues[0].code, 'ENV_FILE_TRACKED');
      assert.equal(result.issues[0].severity, 'error');
      assert.ok(!('line' in result.issues[0]));
    }
  });
  it('ignores foreign files without reading their content', () => {
    const result = runSynth({ 'notes.txt': Buffer.from([0xff, 0xfe]), '.envrc': 'SYNTH_A=one\n' });
    assert.deepEqual(result.records, []);
    assert.deepEqual(result.issues, []);
  });
});
describe('checkEnvExamples: policy and errors', () => {
  it('rejects a missing or broken policy before any content check', () => {
    assertInvalid(() => checkEnvExamples({ files: toMap({ '.env.example': 'SYNTH_A=one\n' }) }));
    assertInvalid(() => checkEnvExamples({ files: toMap({ [POLICY_PATH]: Buffer.from('not json', 'utf8') }) }));
    const cases = [
      (policy) => {
        delete policy.envExamples;
      },
      (policy) => {
        policy.envExamples = {};
      },
      (policy) => {
        policy.envExamples = { credentialKeys: [], addressKeys: ['SYNTH_EXAMPLE_ADDR'] };
      },
      (policy) => {
        policy.envExamples = { credentialKeys: ['SYNTH_EXAMPLE_CRED'], addressKeys: [] };
      },
      (policy) => {
        policy.envExamples = {
          credentialKeys: ['SYNTH_EXAMPLE_CRED', 'SYNTH_EXAMPLE_CRED'],
          addressKeys: ['SYNTH_EXAMPLE_ADDR'],
        };
      },
      (policy) => {
        policy.envExamples = { credentialKeys: ['SAME_KEY'], addressKeys: ['SAME_KEY'] };
      },
      (policy) => {
        policy.envExamples = { credentialKeys: ['SYNTH_EXAMPLE_CRED'], addressKeys: ['SYNTH_EXAMPLE_ADDR'], extra: [] };
      },
      (policy) => {
        policy.envExamples = { credentialKeys: ['1BAD'], addressKeys: ['SYNTH_EXAMPLE_ADDR'] };
      },
      (policy) => {
        policy.envExamples = { credentialKeys: 'SYNTH_EXAMPLE_CRED', addressKeys: ['SYNTH_EXAMPLE_ADDR'] };
      },
    ];
    for (const mutate of cases) {
      assertInvalid(() => run({}, mutate));
    }
  });
  it('rejects invalid snapshot contracts with constant German error text', () => {
    const goodPolicy = policyBytes(synthExamples);
    const badCalls = [
      undefined,
      null,
      'x',
      42,
      [],
      {},
      { files: null },
      { files: {} },
      { files: [] },
      { files: new Map([['/absolute.env.example', Buffer.from('SYNTH_A=one\n', 'utf8')]]) },
      { files: new Map([['a\\b.env.example', Buffer.from('SYNTH_A=one\n', 'utf8')]]) },
      { files: new Map([['a/../b.env.example', Buffer.from('SYNTH_A=one\n', 'utf8')]]) },
      { files: new Map([['.env.example', 'SYNTH_A=one\n']]) },
      {
        files: new Map([
          [POLICY_PATH, goodPolicy],
          ['.env.example', 42],
        ]),
      },
    ];
    for (const input of badCalls) {
      assertInvalid(() => checkEnvExamples(input), ['synth']);
    }
  });
  it('keeps raw values out of records issues and invalid errors', () => {
    const marker = 'synth-secret-marker-7f3a';
    const result = runSynth({ '.env.example': `SYNTH_UNKNOWN=${marker}\n` });
    assert.ok(!JSON.stringify(result).includes(marker));
    for (const record of result.records) {
      assert.deepEqual(Object.keys(record).sort(), ['kind', 'line', 'path']);
    }
    for (const issue of result.issues) {
      const keys = Object.keys(issue).sort();
      assert.ok(keys.includes('code') && keys.includes('path') && keys.includes('severity'));
      assert.ok(!JSON.stringify(issue).includes(marker));
    }
    assertInvalid(
      () =>
        checkEnvExamples({
          files: new Map([
            [POLICY_PATH, policyBytes(synthExamples)],
            ['invalid/../synth-secret-marker-7f3a.env.example', Buffer.from('x')],
          ]),
        }),
      [marker],
    );
  });
  it('sorts issues deterministically by path line and code', () => {
    const result = runSynth({
      'b/.env.example': 'SYNTH_A=one\nSYNTH_A=two\n',
      'a/.env.example': '# note\nSYNTH_BAD=bad # value\n',
    });
    const order = result.issues.map((issue) => `${issue.path}:${issue.line ?? ''}:${issue.code}`);
    assert.deepEqual([...order].sort(), order);
    const wide = runSynth({ '.env.example': '\nSYNTH_A=one\n\n\n\n\n\n\n\nSYNTH_B=two\n' });
    assert.deepEqual(
      wide.issues.map((issue) => issue.line),
      [2, 10],
    );
  });
});
describe('checkEnvExamples: purity and streams', () => {
  it('leaves input maps buffers and process env unchanged', () => {
    const files = toMap({ '.env.example': 'SYNTH_A=one\n# note\n' });
    files.set(POLICY_PATH, policyBytes(synthExamples));
    const beforeKeys = [...files.keys()];
    const beforeBytes = new Map([...files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
    const envBefore = { ...process.env };
    checkEnvExamples({ files });
    assert.deepEqual([...files.keys()], beforeKeys);
    for (const [name, bytes] of files) {
      assert.ok(bytes.equals(beforeBytes.get(name)));
    }
    const envSame =
      Object.keys(envBefore).length === Object.keys(process.env).length &&
      Object.keys(envBefore).every((key) => process.env[key] === envBefore[key]);
    assert.ok(envSame, 'process environment was modified');
  });
  it('encapsulates streams in a real node child without secret dumps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), CHILD_PREFIX));
    try {
      const runner = path.join(dir, 'run-env-examples.mjs');
      fs.writeFileSync(
        runner,
        `import { pathToFileURL } from 'node:url';\nconst adapter = await import(pathToFileURL(process.env.PROBE_MODULE).href);\nconst files = new Map();\nfiles.set('compliance/policy.json', Buffer.from(process.env.PROBE_POLICY, 'utf8'));\nfiles.set('.env.example', Buffer.from('SYNTH_EXAMPLE_CRED=synth-stream-marker-9d4e\\n', 'utf8'));\nprocess.stdout.write(JSON.stringify(adapter.checkEnvExamples({ files })));\n`,
      );
      const policyText = JSON.stringify({
        ...basePolicy(),
        envExamples: { credentialKeys: ['SYNTH_EXAMPLE_CRED'], addressKeys: ['SYNTH_EXAMPLE_ADDR'] },
      });
      const env = { ...process.env, PROBE_MODULE: MODULE_PATH, PROBE_POLICY: policyText };
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      const child = spawnSync(process.execPath, [runner], {
        cwd: dir,
        env,
        encoding: 'utf8',
        timeout: 120000,
        killSignal: 'SIGKILL',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      assert.equal(child.status, 0);
      assert.ok(child.stderr === '', 'child stderr was not empty');
      const parsed = JSON.parse(child.stdout);
      assert.equal(parsed.records.length, 1);
      for (const record of parsed.records) {
        assert.deepEqual(Object.keys(record).sort(), ['kind', 'line', 'path']);
      }
      for (const issue of parsed.issues) {
        assert.ok(['error', 'info'].includes(issue.severity));
        assert.ok(typeof issue.code === 'string' && typeof issue.path === 'string');
        assert.ok(!('value' in issue) && !('source' in issue) && !('hash' in issue));
      }
      assert.ok(!child.stdout.includes('synth-stream-marker-9d4e'), 'child stdout leaked the marker');
      assert.ok(!child.stderr.includes('synth-stream-marker-9d4e'), 'child stderr leaked the marker');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it('maps unexpected failures to the constant failed error without leaks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), CHILD_PREFIX));
    try {
      const runner = path.join(dir, 'run-env-failed.mjs');
      fs.writeFileSync(
        runner,
        `import { pathToFileURL } from 'node:url';\nconst adapter = await import(pathToFileURL(process.env.PROBE_MODULE).href);\nconst options = {};\nObject.defineProperty(options, 'files', { enumerable: true, configurable: true, get() { throw new Error('synth-options-failure-marker'); } });\ntry {\nadapter.checkEnvExamples(options);\nprocess.stdout.write('unexpected success');\nprocess.exitCode = 3;\n} catch (error) {\nprocess.stdout.write(JSON.stringify({ code: error.code, exitCode: error.exitCode, message: error.message }));\nprocess.exitCode = error.exitCode ?? 1;\n}\n`,
      );
      const policyText = JSON.stringify({
        ...basePolicy(),
        envExamples: { credentialKeys: ['SYNTH_EXAMPLE_CRED'], addressKeys: ['SYNTH_EXAMPLE_ADDR'] },
      });
      const env = { ...process.env, PROBE_MODULE: MODULE_PATH, PROBE_POLICY: policyText };
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      const child = spawnSync(process.execPath, [runner], {
        cwd: dir,
        env,
        encoding: 'utf8',
        timeout: 120000,
        killSignal: 'SIGKILL',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      assert.equal(child.status, 2);
      const parsed = JSON.parse(child.stdout);
      assert.equal(parsed.code, 'COMPLIANCE_ENV_EXAMPLE_FAILED');
      assert.equal(parsed.exitCode, 2);
      assert.equal(parsed.message, ENV_FAILED_MESSAGE);
      assert.ok(!child.stdout.includes('synth-options-failure-marker'), 'child stdout leaked the marker');
      assert.ok(!child.stderr.includes('synth-options-failure-marker'), 'child stderr leaked the marker');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe('checkEnvExamples: boundary regressions', () => {
  it('flags password-only URL userinfo as credential review', () => {
    const passwordOnly = runSynth({
      '.env.example': 'SYNTH_PLAIN_URL=https://:synth-pass-01@synth-host.example/db\n',
    });
    assert.ok(codesOf(passwordOnly).includes('ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED'));
  });
  it('rejects a trailing CR without LF and keeps CRLF valid', () => {
    const eofCr = runSynth({ '.env.example': Buffer.from('SYNTH_A=one\r', 'utf8') });
    assert.equal(eofCr.records[0].kind, 'unsupported');
    assert.ok(codesOf(eofCr).includes('ENV_EXAMPLE_SYNTAX_UNSUPPORTED'));
    const midCr = runSynth({ '.env.example': Buffer.from('SYNTH_A=one\r\nSYNTH_B=two\r', 'utf8') });
    assert.equal(midCr.records[1].kind, 'unsupported');
    assert.ok(codesOf(midCr).includes('ENV_EXAMPLE_SYNTAX_UNSUPPORTED'));
    const crlf = runSynth({ '.env.example': Buffer.from('SYNTH_A=one\r\nSYNTH_B=two\r\n', 'utf8') });
    assert.ok(crlf.records.every((record) => record.kind === 'assignment'));
  });
  it('rejects empty dot and control path segments with safe counter-cases', () => {
    const badNames = [
      'a//.env.example',
      './.env.example',
      'a/./.env.example',
      '.env.example/..',
      'a\x01b/.env.example',
      'a\x1fb/.env.example',
      'a\x7fb/.env.example',
      'a\x9fb/.env.example',
      'a' + String.fromCharCode(8232) + 'b/.env.example',
      'a' + String.fromCharCode(8233) + 'b/.env.example',
    ];
    for (const name of badNames) {
      assertInvalid(
        () =>
          checkEnvExamples({
            files: new Map([
              [POLICY_PATH, policyBytes(synthExamples)],
              [name, Buffer.from('SYNTH_A=one\n', 'utf8')],
            ]),
          }),
        ['synth'],
      );
    }
    for (const name of ['a/.env.example', 'deep/nested/dir/.env.staging.example']) {
      const result = runSynth({ [name]: 'SYNTH_A=one\n' });
      assert.equal(result.records.length, 1);
      assert.equal(result.records[0].path, name);
    }
  });
  it('maps foreign coded exceptions to the constant failed error', () => {
    const marker = 'synth-foreign-marker-4b1c';
    const options = {};
    Object.defineProperty(options, 'files', {
      enumerable: true,
      configurable: true,
      get() {
        const error = new Error(`foreign failure ${marker}`);
        error.code = 'COMPLIANCE_DATA_INVALID';
        throw error;
      },
    });
    assert.throws(
      () => checkEnvExamples(options),
      (error) => {
        assert.equal(error.code, 'COMPLIANCE_ENV_EXAMPLE_FAILED');
        assert.equal(error.exitCode, 2);
        assert.equal(error.message, ENV_FAILED_MESSAGE);
        assert.ok(!error.message.includes(marker));
        return true;
      },
    );
  });
});

// closed automatic defaults for the numeric, boolean, literal and URL rules with synthetic fixtures only.
const R_ACCEPTED = 'ENV_EXAMPLE_DEFAULT_ACCEPTED';
const R_VALUE = 'ENV_EXAMPLE_VALUE_REVIEW_REQUIRED';
const R_ADDRESS = 'ENV_EXAMPLE_ADDRESS_REVIEW_REQUIRED';
const R_CRED = 'ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED';
const R_PORT_KEYS = ['PORT', 'POSTGRES_PORT', 'LK_RTC_TCP_PORT', 'LK_RTC_UDP_PORT', 'SMTP_PORT'];
const R_INT_KEYS = [
  'AUDIO_ZONE_HYSTERESIS_SAMPLES',
  'AUDIO_ZONE_HYSTERESIS_MS',
  'AUDIO_ZONE_RECONCILE_INTERVAL_MS',
  'AUDIO_ZONE_PUSH_BATCH_MS',
  'AUDIO_ZONE_HYSTERESIS_SWEEP_MS',
  'VITE_LIVEKIT_TOKEN_TIMEOUT_MS',
  'VITE_LIVEKIT_CONNECT_TIMEOUT_MS',
  'VITE_LIVEKIT_URL_TIMEOUT_MS',
  'VITE_COLYSEUS_JOIN_TIMEOUT_MS',
  'VITE_COLYSEUS_STATE_TIMEOUT_MS',
  'VITE_MIC_PUBLISH_TIMEOUT_MS',
  'TRUST_PROXY',
  'RATE_LIMIT_LOGIN_WINDOW_MS',
  'RATE_LIMIT_LOGIN_MAX',
  'RATE_LIMIT_REGISTER_WINDOW_MS',
  'RATE_LIMIT_REGISTER_MAX',
  'RATE_LIMIT_PASSWORD_RESET_WINDOW_MS',
  'RATE_LIMIT_PASSWORD_RESET_MAX',
  'RATE_LIMIT_FORGOT_PASSWORD_EMAIL_WINDOW_MS',
  'RATE_LIMIT_FORGOT_PASSWORD_EMAIL_MAX',
  'RATE_LIMIT_EMAIL_VERIFICATION_WINDOW_MS',
  'RATE_LIMIT_EMAIL_VERIFICATION_MAX',
  'RATE_LIMIT_GUEST_LOGIN_WINDOW_MS',
  'RATE_LIMIT_GUEST_LOGIN_MAX',
  'RATE_LIMIT_TENANT_SIGNUP_WINDOW_MS',
  'RATE_LIMIT_TENANT_SIGNUP_MAX',
  'RATE_LIMIT_AVATAR_COMPOSE_WINDOW_MS',
  'RATE_LIMIT_AVATAR_COMPOSE_MAX',
  'RATE_LIMIT_AVATAR_RESOLVE_WINDOW_MS',
  'RATE_LIMIT_AVATAR_RESOLVE_MAX',
  'RATE_LIMIT_MATCHMAKE_WINDOW_MS',
  'RATE_LIMIT_MATCHMAKE_MAX',
];
const R_BOOL_KEYS = [
  'LK_RTC_USE_EXTERNAL_IP',
  'VITE_FEATURE_AV_SETTINGS',
  'VITE_FEATURE_VOICE_ONLY',
  'VITE_DEBUG_LOGS',
  'VITE_DEBUG_AUTOLOGIN',
  'COOKIE_SECURE',
  'PUBLIC_REGISTRATION_ENABLED',
  'RATE_LIMIT_ENABLED',
  'AVATAR_EDITOR_ENABLED',
  'MOBILE_GATEWAY_ENABLED',
  'SMTP_POOL',
  'SMTP_TLS_REJECT_UNAUTHORIZED',
  'SMTP_VERIFY_ON_BOOT',
];
const R_LITERALS = {
  NODE_ENV: ['development', 'test', 'production'],
  LOG_LEVEL: ['debug', 'info', 'warn', 'error', 'silent'],
  SMTP_SECURE: ['auto'],
};
const R_URL_SPECS = {
  LIVEKIT_EXTERNAL_URL: { schemes: ['http', 'https', 'ws', 'wss'], paths: ['', '/'] },
  VITE_API_BASE: { schemes: ['http', 'https'], paths: ['', '/', '/api', '/api/'] },
  VITE_LIVEKIT_URL: { schemes: ['http', 'https', 'ws', 'wss'], paths: ['', '/'] },
};
const R_REGISTER_PATH = 'compliance/env-example-reviews.json';
function rRun(entries) {
  return run(entries, undefined);
}
function rAccepted(result) {
  return result.issues.filter((issue) => issue.code === R_ACCEPTED);
}
function assertRAccepted(issue, ruleId, reviewCode) {
  assert.deepEqual(Object.keys(issue).sort(), ['code', 'line', 'path', 'reviewCode', 'ruleId', 'severity', 'status']);
  assert.equal(issue.code, R_ACCEPTED);
  assert.equal(issue.severity, 'info');
  assert.equal(issue.status, 'ACCEPTED');
  assert.equal(issue.ruleId, ruleId);
  assert.equal(issue.reviewCode, reviewCode);
}
function rNoLeak(result, marker) {
  assert.ok(!JSON.stringify(result).includes(marker));
}
describe('checkEnvExamples: safe defaults ports', () => {
  it('accepts listed port boundaries', () => {
    for (const key of R_PORT_KEYS) {
      for (const val of ['1', '65535']) {
        const result = rRun({ '.env.example': `${key}=${val}\n` });
        assert.equal(result.records.length, 1);
        assert.equal(result.records[0].kind, 'assignment');
        assert.equal(result.issues.length, 1);
        assertRAccepted(result.issues[0], 'ENV-DEFAULT-NUMERIC', R_VALUE);
        assert.equal(result.issues[0].path, '.env.example');
        assert.equal(result.issues[0].line, 1);
      }
    }
  });
  it('keeps malformed port content under review', () => {
    const bad = ['0', '65536', '-1', '+1', '01', '00', '1.0', '1e3', '0x10', '99999999999999999999'];
    for (const key of R_PORT_KEYS) {
      for (const val of bad) {
        const result = rRun({ '.env.example': `${key}=${val}\n` });
        assert.ok(!result.issues.some((issue) => issue.code === R_ACCEPTED));
        assert.ok(codesOf(result).includes(R_VALUE));
      }
      for (const val of ['" 1"', '"1 "']) {
        const result = rRun({ '.env.example': `${key}=${val}\n` });
        assert.ok(!result.issues.some((issue) => issue.code === R_ACCEPTED));
        assert.ok(codesOf(result).includes(R_VALUE));
      }
    }
    const secret = 'synth-secret-port-aa01';
    const secResult = rRun({ '.env.example': `PORT=${secret}\n` });
    assert.ok(!secResult.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(secResult).includes(R_VALUE));
    rNoLeak(secResult, secret);
    const unknown = rRun({ '.env.example': 'SYNTH_UNKNOWN_R1_PORT=1234\n' });
    assert.ok(!unknown.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(unknown).includes(R_VALUE));
    const cred = rRun({ '.env.example': 'POSTGRES_PASSWORD=1234\n' }, undefined);
    assert.ok(!cred.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(cred).includes(R_CRED));
  });
});
describe('checkEnvExamples: safe defaults integers', () => {
  it('accepts listed integer boundaries', () => {
    for (const key of R_INT_KEYS) {
      for (const val of ['0', '2147483647']) {
        const result = rRun({ '.env.example': `${key}=${val}\n` });
        assert.equal(result.issues.length, 1);
        assertRAccepted(result.issues[0], 'ENV-DEFAULT-NUMERIC', R_VALUE);
      }
    }
  });
  it('keeps malformed integer content under review', () => {
    const bad = ['2147483648', '-1', '+1', '01', '1.0', '1e3', '0x1', '99999999999999999999'];
    for (const key of R_INT_KEYS) {
      for (const val of bad) {
        const result = rRun({ '.env.example': `${key}=${val}\n` });
        assert.ok(!result.issues.some((issue) => issue.code === R_ACCEPTED));
        assert.ok(codesOf(result).includes(R_VALUE));
      }
    }
    const secret = 'synth-secret-int-bb02';
    const secResult = rRun({ '.env.example': `VITE_LIVEKIT_TOKEN_TIMEOUT_MS=${secret}\n` });
    assert.ok(!secResult.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(secResult).includes(R_VALUE));
    rNoLeak(secResult, secret);
    const unknown = rRun({ '.env.example': 'SYNTH_UNKNOWN_R1_INT=42\n' });
    assert.ok(!unknown.issues.some((issue) => issue.code === R_ACCEPTED));
    const cred = rRun({ '.env.example': 'POSTGRES_PASSWORD=42\n' }, undefined);
    assert.ok(!cred.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(cred).includes(R_CRED));
  });
  it('keeps trust proxy non-decimal forms under review', () => {
    for (const val of ['true', 'false', '1.0', '1e3', '0x1', '+1', '-1']) {
      const result = rRun({ '.env.example': `TRUST_PROXY=${val}\n` });
      assert.ok(!result.issues.some((issue) => issue.code === R_ACCEPTED));
      assert.ok(codesOf(result).includes(R_VALUE));
    }
    const secret = 'synth-secret-trust-cc03';
    const secResult = rRun({ '.env.example': `TRUST_PROXY=${secret}\n` });
    assert.ok(!secResult.issues.some((issue) => issue.code === R_ACCEPTED));
    rNoLeak(secResult, secret);
  });
});
describe('checkEnvExamples: safe defaults booleans', () => {
  it('accepts listed boolean literals', () => {
    for (const key of R_BOOL_KEYS) {
      for (const val of ['true', 'false']) {
        const result = rRun({ '.env.example': `${key}=${val}\n` });
        assert.equal(result.issues.length, 1);
        assertRAccepted(result.issues[0], 'ENV-DEFAULT-BOOLEAN', R_VALUE);
      }
    }
  });
  it('keeps non-canonical boolean content under review', () => {
    const bad = ['True', 'FALSE', '1', '0', 'yes', 'on', 'true0'];
    for (const key of R_BOOL_KEYS) {
      for (const val of bad) {
        const result = rRun({ '.env.example': `${key}=${val}\n` });
        assert.ok(!result.issues.some((issue) => issue.code === R_ACCEPTED));
        assert.ok(codesOf(result).includes(R_VALUE));
      }
      for (const val of ['"true "', '" false"']) {
        const result = rRun({ '.env.example': `${key}=${val}\n` });
        assert.ok(!result.issues.some((issue) => issue.code === R_ACCEPTED));
      }
    }
    const secret = 'synth-secret-dd04';
    const secResult = rRun({ '.env.example': `COOKIE_SECURE=${secret}\n` });
    assert.ok(!secResult.issues.some((issue) => issue.code === R_ACCEPTED));
    rNoLeak(secResult, secret);
    const cred = rRun({ '.env.example': 'POSTGRES_PASSWORD=true\n' }, undefined);
    assert.ok(!cred.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(cred).includes(R_CRED));
    const unknown = rRun({ '.env.example': 'SYNTH_UNKNOWN_R2=true\n' });
    assert.ok(!unknown.issues.some((issue) => issue.code === R_ACCEPTED));
  });
});
describe('checkEnvExamples: safe defaults literals', () => {
  it('accepts each closed literal', () => {
    for (const key of Object.keys(R_LITERALS)) {
      for (const val of R_LITERALS[key]) {
        const result = rRun({ '.env.example': `${key}=${val}\n` });
        assert.equal(result.issues.length, 1);
        assertRAccepted(result.issues[0], 'ENV-DEFAULT-LITERAL', R_VALUE);
      }
    }
  });
  it('keeps unknown literals and foreign keys under review', () => {
    for (const [key, val] of [
      ['NODE_ENV', 'staging'],
      ['NODE_ENV', 'Production'],
      ['LOG_LEVEL', 'trace'],
      ['LOG_LEVEL', 'verbose'],
      ['LOG_LEVEL', 'fatal'],
      ['LOG_LEVEL', 'DEBUG'],
      ['SMTP_SECURE', 'true'],
      ['SMTP_SECURE', 'false'],
      ['SMTP_SECURE', 'tls'],
      ['NODE_ENV', '"production "'],
    ]) {
      const result = rRun({ '.env.example': `${key}=${val}\n` });
      assert.ok(!result.issues.some((issue) => issue.code === R_ACCEPTED));
      assert.ok(codesOf(result).includes(R_VALUE));
    }
    const foreign = rRun({ '.env.example': 'SYNTH_NEW_ENUM_FIELD=development\n' });
    assert.ok(!foreign.issues.some((issue) => issue.code === R_ACCEPTED));
    const cred = rRun({ '.env.example': 'POSTGRES_PASSWORD=production\n' }, undefined);
    assert.ok(!cred.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(cred).includes(R_CRED));
  });
});
describe('checkEnvExamples: safe defaults urls', () => {
  it('accepts canonical loopback urls for listed keys', () => {
    for (const key of Object.keys(R_URL_SPECS)) {
      const spec = R_URL_SPECS[key];
      for (const scheme of spec.schemes) {
        for (const host of ['localhost', '127.0.0.1']) {
          for (const p of spec.paths) {
            for (const port of ['', ':1', ':65535']) {
              const result = rRun({ '.env.example': `${key}=${scheme}://${host}${port}${p}\n` });
              assert.equal(result.issues.length, 1, `${key} ${scheme} ${host} ${port} ${p}`);
              assertRAccepted(result.issues[0], 'ENV-DEFAULT-URL', R_ADDRESS);
            }
          }
        }
      }
    }
  });
  it('keeps userinfo query fragment and host variants under review', () => {
    const key = 'LIVEKIT_EXTERNAL_URL';
    const bad = [
      'http://synth-user@localhost/',
      'http://:synth-pass-01@localhost/',
      'http://synth-user:synth-pass-02@localhost/',
      'http://@localhost/',
      'http://synth-host.example/',
      'http://192.168.1.10/',
      'http://10.0.0.1/',
      'http://db/',
      'http://127.1/',
      'http://0x7f.0.0.1/',
      'http://localhost./',
      'http://LOCALHOST/',
      'http://[::1]/',
      'http://127.0.0.1./',
      'http://localhost/?a=1',
      'http://localhost/#frag',
      'http://localhost:0/',
      'http://localhost:65536/',
      'http://localhost:01/',
      'http://localhost/secret',
      'http://localhost/api/v1',
      'http://localhost/other',
      'http://localhost/API',
      'http://localhost/%2e',
      'ftp://localhost/',
      'file://localhost/',
    ];
    for (const val of bad) {
      const result = rRun({ '.env.example': `${key}=${val}\n` });
      assert.ok(!result.issues.some((issue) => issue.code === R_ACCEPTED), val);
      assert.ok(result.issues.length > 0, val);
    }
    const emptyQ = rRun({ '.env.example': `${key}=http://localhost/?\n` });
    assert.ok(!emptyQ.issues.some((issue) => issue.code === R_ACCEPTED));
    const emptyF = rRun({ '.env.example': `${key}="http://localhost/#"\n` });
    assert.ok(!emptyF.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(emptyF).includes(R_ADDRESS));
    const wsScheme = rRun({ '.env.example': 'VITE_API_BASE=ws://localhost/\n' });
    assert.ok(!wsScheme.issues.some((issue) => issue.code === R_ACCEPTED));
    const secret = 'synth-secret-ee05';
    const secResult = rRun({ '.env.example': `VITE_API_BASE=http://localhost/${secret}\n` });
    assert.ok(!secResult.issues.some((issue) => issue.code === R_ACCEPTED));
    rNoLeak(secResult, secret);
    const unknown = rRun({ '.env.example': 'SYNTH_UNKNOWN_R4=http://localhost/\n' });
    assert.ok(!unknown.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(unknown).includes(R_ADDRESS));
    const cred = rRun({ '.env.example': 'POSTGRES_PASSWORD=http://localhost/\n' }, undefined);
    assert.ok(!cred.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(cred).includes(R_CRED));
  });
  it('rejects loopback dot segments without normalization', () => {
    const key = 'LIVEKIT_EXTERNAL_URL';
    const bad = [
      'http://localhost/./',
      'http://localhost/../',
      'http://localhost/a/..',
      'http://localhost/a/../',
      'http://localhost/api/../',
      'http://localhost/api/./',
    ];
    for (const val of bad) {
      const result = rRun({ '.env.example': `${key}=${val}\n` });
      assert.ok(!result.issues.some((issue) => issue.code === R_ACCEPTED), val);
      assert.ok(codesOf(result).includes(R_ADDRESS), val);
    }
  });
});
describe('checkEnvExamples: safe defaults precedence and quoting', () => {
  it('applies identical matches for quoted and commented assignments', () => {
    const cases = [
      ['PORT', '1', 'ENV-DEFAULT-NUMERIC', R_VALUE],
      ['COOKIE_SECURE', 'true', 'ENV-DEFAULT-BOOLEAN', R_VALUE],
      ['NODE_ENV', 'production', 'ENV-DEFAULT-LITERAL', R_VALUE],
      ['VITE_LIVEKIT_URL', 'http://localhost/', 'ENV-DEFAULT-URL', R_ADDRESS],
    ];
    for (const [key, val, ruleId, reviewCode] of cases) {
      for (const content of [`${key}=${val}\n`, `${key}="${val}"\n`, `${key}='${val}'\n`, `# ${key}=${val}\n`]) {
        const result = rRun({ '.env.example': content });
        assert.equal(result.issues.length, 1, content);
        assertRAccepted(result.issues[0], ruleId, reviewCode);
      }
    }
    const empty = rRun({ '.env.example': 'PORT=\n' });
    assert.deepEqual(empty.issues, []);
  });
  it('keeps syntax bom cr duplicate and real env findings hard', () => {
    const bom = rRun({
      '.env.example': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('PORT=1\n', 'utf8')]),
    });
    assert.ok(codesOf(bom).includes('ENV_EXAMPLE_SYNTAX_UNSUPPORTED'));
    assert.ok(!bom.issues.some((issue) => issue.code === R_ACCEPTED));
    const lone = rRun({ '.env.example': Buffer.from('PORT=1\r', 'utf8') });
    assert.ok(codesOf(lone).includes('ENV_EXAMPLE_SYNTAX_UNSUPPORTED'));
    const dup = rRun({ '.env.example': 'PORT=1\nPORT=65535\n' });
    assert.ok(codesOf(dup).includes('ENV_EXAMPLE_DUPLICATE_KEY'));
    assert.equal(rAccepted(dup).length, 2);
    const commented = rRun({ '.env.example': '# PORT=1\n# PORT=65535\n' });
    assert.ok(codesOf(commented).includes('ENV_EXAMPLE_DUPLICATE_KEY'));
    assert.equal(rAccepted(commented).length, 2);
    const tracked = rRun({ '.env': 'PORT=1\n' });
    assert.ok(codesOf(tracked).includes('ENV_FILE_TRACKED'));
    assert.ok(!tracked.issues.some((issue) => issue.code === R_ACCEPTED));
    const syntax = rRun({ '.env.example': 'PORT=bad # value\n' });
    assert.ok(codesOf(syntax).includes('ENV_EXAMPLE_SYNTAX_UNSUPPORTED'));
  });
  it('treats role overlap as data errors', () => {
    assertInvalid(() =>
      run({}, (policy) => {
        policy.envExamples.safeDefaults = {
          version: 1,
          rules: {
            'ENV-DEFAULT-NUMERIC': { portKeys: ['PORT'], integerKeys: [] },
            'ENV-DEFAULT-BOOLEAN': { keys: [] },
            'ENV-DEFAULT-LITERAL': { literals: {} },
            'ENV-DEFAULT-URL': { urls: {} },
          },
        };
        policy.envExamples.credentialKeys.push('PORT');
      }),
    );
    assertInvalid(() =>
      run({}, (policy) => {
        policy.envExamples.safeDefaults = {
          version: 1,
          rules: {
            'ENV-DEFAULT-NUMERIC': { portKeys: [], integerKeys: ['HOST_IP'] },
            'ENV-DEFAULT-BOOLEAN': { keys: [] },
            'ENV-DEFAULT-LITERAL': { literals: {} },
            'ENV-DEFAULT-URL': { urls: {} },
          },
        };
      }),
    );
    const overlaps = [
      ['NODE_ENV', 'credentialKeys'],
      ['NODE_ENV', 'addressKeys'],
      ['VITE_API_BASE', 'credentialKeys'],
      ['VITE_API_BASE', 'addressKeys'],
    ];
    const actualList = [];
    for (const [overlapKey, overlapRole] of overlaps) {
      try {
        run({}, (policy) => {
          policy.envExamples[overlapRole].push(overlapKey);
        });
        actualList.push(null);
      } catch (error) {
        actualList.push({ code: error.code, exitCode: error.exitCode, message: error.message });
      }
    }
    const expectedList = overlaps.map(() => ({
      code: 'COMPLIANCE_DATA_INVALID',
      exitCode: 2,
      message: DATA_INVALID_MESSAGE,
    }));
    assert.deepStrictEqual(actualList, expectedList);
  });
});
describe('checkEnvExamples: safe defaults output shape', () => {
  it('emits exactly one accepted info with stable sorting', () => {
    const result = rRun({
      'b/.env.example': 'PORT=1\nSYNTH_UNKNOWN_X=synth-plain-01\n',
      'a/.env.example': 'NODE_ENV=production\n',
    });
    const tuples = result.issues.map((issue) => `${issue.path}:${issue.line ?? ''}:${issue.code}`);
    assert.deepEqual([...tuples].sort(), tuples);
    assert.equal(rAccepted(result).length, 2);
    for (const issue of rAccepted(result)) {
      assertRAccepted(issue, issue.ruleId, issue.reviewCode);
    }
    assert.deepEqual(
      result.records.map((record) => record.kind),
      ['assignment', 'assignment', 'assignment'],
    );
    assert.ok(!JSON.stringify(result).includes('synth-plain-01'));
  });
  it('requires explicit lists and safe defaults', () => {
    const synth = runSynth({ '.env.example': 'PORT=1\n' });
    assert.ok(!synth.issues.some((issue) => issue.code === R_ACCEPTED));
    const missing = run({ '.env.example': 'PORT=1\n' }, (policy) => {
      delete policy.envExamples.safeDefaults;
    });
    assert.ok(!missing.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(missing).includes(R_VALUE));
  });
});
describe('checkEnvExamples: safe defaults policy boundary', () => {
  it('keeps the legacy two-field policy strictly valid', () => {
    const result = run({ '.env.example': 'PORT=1\n' }, (policy) => {
      delete policy.envExamples.safeDefaults;
    });
    assert.ok(codesOf(result).includes(R_VALUE));
    assert.ok(!result.issues.some((issue) => issue.code === R_ACCEPTED));
  });
  it('rejects malformed safe defaults as data errors', () => {
    const goodRules = () => ({
      'ENV-DEFAULT-NUMERIC': { portKeys: ['PORT'], integerKeys: ['TRUST_PROXY'] },
      'ENV-DEFAULT-BOOLEAN': { keys: ['COOKIE_SECURE'] },
      'ENV-DEFAULT-LITERAL': { literals: { NODE_ENV: ['production'] } },
      'ENV-DEFAULT-URL': { urls: { VITE_LIVEKIT_URL: { schemes: ['http'], paths: ['/'] } } },
    });
    const cases = [
      (policy) => {
        policy.envExamples.safeDefaults = { version: 2, rules: goodRules() };
      },
      (policy) => {
        policy.envExamples.safeDefaults = { version: '1', rules: goodRules() };
      },
      (policy) => {
        policy.envExamples.safeDefaults = { rules: goodRules() };
      },
      (policy) => {
        policy.envExamples.safeDefaults = { version: 1 };
      },
      (policy) => {
        policy.envExamples.safeDefaults = { version: 1, rules: goodRules(), extra: 1 };
      },
      (policy) => {
        const rules = goodRules();
        delete rules['ENV-DEFAULT-URL'];
        policy.envExamples.safeDefaults = { version: 1, rules };
      },
      (policy) => {
        const rules = goodRules();
        rules['ENV-DEFAULT-EXTRA'] = { keys: [] };
        policy.envExamples.safeDefaults = { version: 1, rules };
      },
      (policy) => {
        const rules = goodRules();
        rules['ENV-DEFAULT-NUMERIC'] = { portKeys: ['PORT', 'PORT'], integerKeys: [] };
        policy.envExamples.safeDefaults = { version: 1, rules };
      },
      (policy) => {
        const rules = goodRules();
        rules['ENV-DEFAULT-NUMERIC'] = { portKeys: ['SAME_KEY'], integerKeys: ['SAME_KEY'] };
        policy.envExamples.safeDefaults = { version: 1, rules };
      },
      (policy) => {
        const rules = goodRules();
        rules['ENV-DEFAULT-BOOLEAN'] = { keys: ['PORT'] };
        policy.envExamples.safeDefaults = { version: 1, rules };
      },
      (policy) => {
        const rules = goodRules();
        rules['ENV-DEFAULT-NUMERIC'] = { portKeys: ['1BAD'], integerKeys: [] };
        policy.envExamples.safeDefaults = { version: 1, rules };
      },
      (policy) => {
        const rules = goodRules();
        rules['ENV-DEFAULT-LITERAL'] = { literals: { NODE_ENV: [] } };
        policy.envExamples.safeDefaults = { version: 1, rules };
      },
      (policy) => {
        const rules = goodRules();
        rules['ENV-DEFAULT-URL'] = { urls: { VITE_LIVEKIT_URL: { schemes: [], paths: ['/'] } } };
        policy.envExamples.safeDefaults = { version: 1, rules };
      },
      (policy) => {
        policy.envExamples.safeDefaults = 'invalid';
      },
    ];
    for (const mutate of cases) {
      assertInvalid(() => run({}, mutate));
    }
  });
  it('rejects policy constants outside the specification', () => {
    const base = () => ({
      'ENV-DEFAULT-NUMERIC': { portKeys: ['PORT'], integerKeys: ['TRUST_PROXY'] },
      'ENV-DEFAULT-BOOLEAN': { keys: ['COOKIE_SECURE'] },
      'ENV-DEFAULT-LITERAL': { literals: { NODE_ENV: ['production'] } },
      'ENV-DEFAULT-URL': { urls: { VITE_LIVEKIT_URL: { schemes: ['http'], paths: ['/'] } } },
    });
    const badLiteral = base();
    badLiteral['ENV-DEFAULT-LITERAL'] = { literals: { NODE_ENV: ['staging'] } };
    assertInvalid(() =>
      run({}, (policy) => {
        policy.envExamples.safeDefaults = { version: 1, rules: badLiteral };
      }),
    );
    const badScheme = base();
    badScheme['ENV-DEFAULT-URL'] = { urls: { VITE_LIVEKIT_URL: { schemes: ['ftp'], paths: ['/'] } } };
    assertInvalid(() =>
      run({}, (policy) => {
        policy.envExamples.safeDefaults = { version: 1, rules: badScheme };
      }),
    );
    const badPath = base();
    badPath['ENV-DEFAULT-URL'] = { urls: { VITE_LIVEKIT_URL: { schemes: ['http'], paths: ['/secret'] } } };
    assertInvalid(() =>
      run({}, (policy) => {
        policy.envExamples.safeDefaults = { version: 1, rules: badPath };
      }),
    );
  });
  it('rejects unknown fields inside rule definitions', () => {
    const base = () => ({
      'ENV-DEFAULT-NUMERIC': { portKeys: ['PORT'], integerKeys: ['TRUST_PROXY'] },
      'ENV-DEFAULT-BOOLEAN': { keys: ['COOKIE_SECURE'] },
      'ENV-DEFAULT-LITERAL': { literals: { NODE_ENV: ['production'] } },
      'ENV-DEFAULT-URL': { urls: { VITE_LIVEKIT_URL: { schemes: ['http'], paths: ['/'] } } },
    });
    const variants = [
      { 'ENV-DEFAULT-NUMERIC': { portKeys: ['PORT'], integerKeys: [], extra: 1 } },
      { 'ENV-DEFAULT-BOOLEAN': { keys: ['COOKIE_SECURE'], extra: 1 } },
      { 'ENV-DEFAULT-LITERAL': { literals: { NODE_ENV: ['production'] }, extra: 1 } },
      { 'ENV-DEFAULT-URL': { urls: { VITE_LIVEKIT_URL: { schemes: ['http'], paths: ['/'] } }, extra: 1 } },
      {
        'ENV-DEFAULT-URL': {
          urls: { VITE_LIVEKIT_URL: { schemes: ['http'], paths: ['/'], extra: 1 } },
        },
      },
    ];
    for (const variant of variants) {
      const rules = { ...base(), ...variant };
      assertInvalid(() =>
        run({}, (policy) => {
          policy.envExamples.safeDefaults = { version: 1, rules };
        }),
      );
    }
  });
  it('allows valid empty rule lists without automatic matches', () => {
    let threw = false;
    let result = null;
    try {
      result = run({ '.env.example': 'PORT=1\n' }, (policy) => {
        policy.envExamples.safeDefaults = {
          version: 1,
          rules: {
            'ENV-DEFAULT-NUMERIC': { portKeys: [], integerKeys: [] },
            'ENV-DEFAULT-BOOLEAN': { keys: [] },
            'ENV-DEFAULT-LITERAL': { literals: {} },
            'ENV-DEFAULT-URL': { urls: {} },
          },
        };
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
    assert.ok(!result.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(codesOf(result).includes(R_VALUE));
  });
  it('normalizes foreign coded failures to the constant error', () => {
    const marker = 'synth-foreign-r78-6e09';
    const options = {};
    Object.defineProperty(options, 'files', {
      enumerable: true,
      configurable: true,
      get() {
        const error = new Error(`foreign failure ${marker}`);
        error.code = R_ACCEPTED;
        throw error;
      },
    });
    assert.throws(
      () => checkEnvExamples(options),
      (error) => {
        assert.equal(error.code, 'COMPLIANCE_ENV_EXAMPLE_FAILED');
        assert.equal(error.exitCode, 2);
        assert.ok(!error.message.includes(marker));
        return true;
      },
    );
  });
});
describe('checkEnvExamples: safe defaults review composition', () => {
  it('passes accepted infos through the review wrapper', async () => {
    const { checkEnvExampleReviews } = await import('./env-example-reviews.mjs');
    const files = toMap({ '.env.example': 'PORT=1\n' });
    files.set(POLICY_PATH, policyBytes(undefined));
    files.set(
      R_REGISTER_PATH,
      Buffer.from(JSON.stringify({ schemaVersion: 1, objectFormat: 'sha1', approvals: [] }), 'utf8'),
    );
    const strict = checkEnvExamples({ files });
    assert.equal(rAccepted(strict).length, 1);
    const composed = checkEnvExampleReviews({ files, objectFormat: 'sha1' });
    assert.deepEqual(composed.records, strict.records);
    assert.deepEqual(composed.issues, strict.issues);
  });
  it('rejects register entries for accepted infos', async () => {
    const { checkEnvExampleReviews } = await import('./env-example-reviews.mjs');
    const files = toMap({ '.env.example': 'PORT=1\n' });
    files.set(POLICY_PATH, policyBytes(undefined));
    files.set(
      R_REGISTER_PATH,
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          objectFormat: 'sha1',
          approvals: [
            {
              path: '.env.example',
              line: 1,
              blobOid: 'a'.repeat(40),
              code: R_ACCEPTED,
              approvedBy: 'user',
              decisionRef: 'ENV-DECISION-001',
            },
          ],
        }),
        'utf8',
      ),
    );
    assertInvalid(() => checkEnvExampleReviews({ files, objectFormat: 'sha1' }));
  });
  it('marks a formerly applicable review unused after automatic acceptance', async () => {
    const { createHash } = await import('node:crypto');
    const { checkEnvExampleReviews } = await import('./env-example-reviews.mjs');
    const content = 'PORT=1\n';
    const bytes = Buffer.from(content, 'utf8');
    const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
    const blobOid = createHash('sha1').update(header).update(bytes).digest('hex');
    const files = toMap({ '.env.example': content });
    files.set(POLICY_PATH, policyBytes(undefined));
    files.set(
      R_REGISTER_PATH,
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          objectFormat: 'sha1',
          approvals: [
            {
              path: '.env.example',
              line: 1,
              blobOid,
              code: R_VALUE,
              approvedBy: 'user',
              decisionRef: 'ENV-DECISION-001',
            },
          ],
        }),
        'utf8',
      ),
    );
    const strict = checkEnvExamples({ files });
    assert.equal(rAccepted(strict).length, 1);
    const composed = checkEnvExampleReviews({ files, objectFormat: 'sha1' });
    assert.ok(composed.issues.some((issue) => issue.code === R_ACCEPTED));
    assert.ok(composed.issues.some((issue) => issue.code === 'ENV_EXAMPLE_REVIEW_UNUSED'));
    assert.ok(!composed.issues.some((issue) => issue.code === 'ENV_EXAMPLE_VALUE_REVIEW_ACCEPTED'));
  });
});
