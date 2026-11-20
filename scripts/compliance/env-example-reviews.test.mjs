// Tests for the pure env example review composition.
//
// Fixtures are synthetic in-memory maps and buffers: no real template values
// are copied and no git blob is read. Every binding refers to the complete
// bytes of a synthetic template.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { checkEnvExamples } from './env-examples.mjs';
import { checkEnvExampleReviews } from './env-example-reviews.mjs';

const POLICY_PATH = 'compliance/policy.json';
const REGISTER_PATH = 'compliance/env-example-reviews.json';
const DATA_INVALID_MESSAGE = 'The compliance data is invalid.';
const REVIEW_FAILED_MESSAGE = 'The check of the example approvals failed.';
const CRED = 'ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED';
const ADDR = 'ENV_EXAMPLE_ADDRESS_REVIEW_REQUIRED';
const VALUE = 'ENV_EXAMPLE_VALUE_REVIEW_REQUIRED';
const CRED_OK = 'ENV_EXAMPLE_CREDENTIAL_REVIEW_ACCEPTED';
const ADDR_OK = 'ENV_EXAMPLE_ADDRESS_REVIEW_ACCEPTED';
const VALUE_OK = 'ENV_EXAMPLE_VALUE_REVIEW_ACCEPTED';
const STALE = 'ENV_EXAMPLE_REVIEW_STALE';
const UNUSED = 'ENV_EXAMPLE_REVIEW_UNUSED';
const DUPLICATE = 'ENV_EXAMPLE_DUPLICATE_KEY';
const SYNTAX = 'ENV_EXAMPLE_SYNTAX_UNSUPPORTED';
const TRACKED = 'ENV_FILE_TRACKED';
const PROSE = 'ENV_EXAMPLE_PROSE_SECRET_SCAN_DEFERRED';
// Fixed whole-blob oracles: empty blob and UTF8 'hello' with exactly LF.
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
const HELLO_BLOB = 'ce013625030ba8dba906f756967f9e9ca394464a';

const CRED_PATH = 'cfg/.env.example';
const ADDR_PATH = 'cfg/addr/.env.local.example';
const OTHER_PATH = 'cfg/other/.env.example';
const CRED_BYTES = Buffer.from('SYNTH_EB_CRED=synth-token-a\n', 'utf8');
const ADDR_BYTES = Buffer.from('SYNTH_EB_ADDR=synth-token-b\n', 'utf8');
const OTHER_BYTES = Buffer.from('SYNTH_EB_OTHER=synth-token-c\n', 'utf8');

function policyBytes() {
  return Buffer.from(
    JSON.stringify({
      envExamples: {
        credentialKeys: ['SYNTH_EB_CRED'],
        addressKeys: ['SYNTH_EB_ADDR'],
      },
    }),
    'utf8',
  );
}

// Whole git blob identity over the complete template bytes, test fixture only.
function blobId(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

function approval(targetPath, line, bytes, code, over = {}) {
  return {
    path: targetPath,
    line,
    blobOid: blobId(bytes),
    code,
    approvedBy: 'user',
    decisionRef: 'ENV-DECISION-101',
    ...over,
  };
}

function registerBytes(approvals) {
  return Buffer.from(JSON.stringify({ schemaVersion: 1, objectFormat: 'sha1', approvals }), 'utf8');
}

function filesMap(entries, approvals) {
  const files = new Map();
  files.set(POLICY_PATH, policyBytes());
  files.set(REGISTER_PATH, registerBytes(approvals));
  for (const [name, bytes] of entries) files.set(name, bytes);
  return files;
}

function run(entries, approvals = [], objectFormat = 'sha1') {
  return checkEnvExampleReviews({ files: filesMap(entries, approvals), objectFormat });
}

function strictResult(entries, approvals = []) {
  return checkEnvExamples({ files: filesMap(entries, approvals) });
}

function tuples(result) {
  return result.issues.map((issue) => [issue.path, issue.line ?? null, issue.code, issue.severity]);
}

function assertInvalid(call, markers = []) {
  assert.throws(call, (error) => {
    assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
    assert.equal(error.exitCode, 2);
    assert.ok(error.message === DATA_INVALID_MESSAGE, 'unexpected data error message');
    for (const marker of markers) {
      assert.ok(!error.message.includes(marker));
    }
    return true;
  });
}

function assertFailed(call) {
  assert.throws(call, (error) => {
    assert.equal(error.code, 'COMPLIANCE_ENV_EXAMPLE_REVIEW_FAILED');
    assert.equal(error.exitCode, 2);
    assert.ok(error.message === REVIEW_FAILED_MESSAGE, 'unexpected review error message');
    return true;
  });
}

describe('checkEnvExampleReviews: empty register equals the strict check', () => {
  it('returns the strict result for an empty register', () => {
    const entries = [
      [CRED_PATH, CRED_BYTES],
      [OTHER_PATH, OTHER_BYTES],
    ];
    const result = run(entries, []);
    assert.deepEqual(result, strictResult(entries, []));
  });

  it('leaves empty values without approval inconspicuous', () => {
    const result = run([[OTHER_PATH, Buffer.from('SYNTH_EB_OTHER=\n', 'utf8')]], []);
    assert.deepEqual(result.issues, []);
  });
});

describe('checkEnvExampleReviews: exact single bindings', () => {
  it('accepts an exact credential binding', () => {
    const result = run([[CRED_PATH, CRED_BYTES]], [approval(CRED_PATH, 1, CRED_BYTES, CRED)]);
    assert.deepEqual(tuples(result), [[CRED_PATH, 1, CRED_OK, 'info']]);
  });

  it('accepts an exact address binding', () => {
    const result = run([[ADDR_PATH, ADDR_BYTES]], [approval(ADDR_PATH, 1, ADDR_BYTES, ADDR)]);
    assert.deepEqual(tuples(result), [[ADDR_PATH, 1, ADDR_OK, 'info']]);
  });

  it('accepts an exact value binding', () => {
    const result = run([[OTHER_PATH, OTHER_BYTES]], [approval(OTHER_PATH, 1, OTHER_BYTES, VALUE)]);
    assert.deepEqual(tuples(result), [[OTHER_PATH, 1, VALUE_OK, 'info']]);
  });

  it('keeps the same content at another path red', () => {
    const result = run(
      [
        [CRED_PATH, CRED_BYTES],
        [OTHER_PATH, CRED_BYTES],
      ],
      [approval(CRED_PATH, 1, CRED_BYTES, CRED)],
    );
    assert.deepEqual(tuples(result), [
      [CRED_PATH, 1, CRED_OK, 'info'],
      [OTHER_PATH, 1, CRED, 'error'],
    ]);
  });

  it('keeps another finding of the same class on a different line red', () => {
    const bytes = Buffer.from('SYNTH_EB_FIRST=one\nSYNTH_EB_SECOND=two\n', 'utf8');
    const result = run([[OTHER_PATH, bytes]], [approval(OTHER_PATH, 1, bytes, VALUE)]);
    assert.deepEqual(tuples(result), [
      [OTHER_PATH, 1, VALUE_OK, 'info'],
      [OTHER_PATH, 2, VALUE, 'error'],
    ]);
  });

  it('accepts an exact commented assignment binding', () => {
    const bytes = Buffer.from('# SYNTH_EB_CRED=synthetic-comment-value\n', 'utf8');
    const result = run([[CRED_PATH, bytes]], [approval(CRED_PATH, 1, bytes, CRED)]);
    assert.deepEqual(tuples(result), [[CRED_PATH, 1, CRED_OK, 'info']]);
    assert.equal(result.records[0].kind, 'commented_assignment');
  });

  it('keeps other lines of the same file red', () => {
    const bytes = Buffer.concat([CRED_BYTES, OTHER_BYTES]);
    const result = run([[CRED_PATH, bytes]], [approval(CRED_PATH, 1, bytes, CRED)]);
    assert.deepEqual(tuples(result), [
      [CRED_PATH, 1, CRED_OK, 'info'],
      [CRED_PATH, 2, VALUE, 'error'],
    ]);
  });
});

describe('checkEnvExampleReviews: stale bindings', () => {
  it('reports stale when the target line changes and keeps the original issue', () => {
    const changed = Buffer.from('SYNTH_EB_CRED=synth-token-d\n', 'utf8');
    const result = run([[CRED_PATH, changed]], [approval(CRED_PATH, 1, CRED_BYTES, CRED)]);
    assert.deepEqual(tuples(result), [
      [CRED_PATH, 1, CRED, 'error'],
      [CRED_PATH, 1, STALE, 'error'],
    ]);
  });

  it('reports stale when another line of the file changes', () => {
    const before = Buffer.concat([CRED_BYTES, OTHER_BYTES]);
    const after = Buffer.concat([CRED_BYTES, Buffer.from('SYNTH_EB_OTHER=synth-token-d\n', 'utf8')]);
    const result = run([[CRED_PATH, after]], [approval(CRED_PATH, 1, before, CRED)]);
    assert.deepEqual(tuples(result), [
      [CRED_PATH, 1, CRED, 'error'],
      [CRED_PATH, 1, STALE, 'error'],
      [CRED_PATH, 2, VALUE, 'error'],
    ]);
  });

  it('reports stale when lines shift', () => {
    const shifted = Buffer.concat([Buffer.from('# synth note\n', 'utf8'), CRED_BYTES]);
    const result = run([[CRED_PATH, shifted]], [approval(CRED_PATH, 1, CRED_BYTES, CRED)]);
    assert.ok(
      tuples(result).some(
        ([path, line, code, severity]) => path === CRED_PATH && line === 1 && code === STALE && severity === 'error',
      ),
    );
    assert.ok(tuples(result).some(([path, line, code]) => path === CRED_PATH && line === 2 && code === CRED));
  });

  it('reports stale when line endings change', () => {
    const crlf = Buffer.from('SYNTH_EB_CRED=synth-token-a\r\n', 'utf8');
    const result = run([[CRED_PATH, crlf]], [approval(CRED_PATH, 1, CRED_BYTES, CRED)]);
    assert.ok(tuples(result).some(([, , code]) => code === STALE));
    assert.ok(tuples(result).some(([, , code]) => code === CRED));
  });
});

describe('checkEnvExampleReviews: revert and removal', () => {
  it('accepts again after an exact blob revert', () => {
    const changed = Buffer.from('SYNTH_EB_CRED=synth-token-d\n', 'utf8');
    const entry = approval(CRED_PATH, 1, CRED_BYTES, CRED);
    assert.deepEqual(tuples(run([[CRED_PATH, CRED_BYTES]], [entry])), [[CRED_PATH, 1, CRED_OK, 'info']]);
    assert.ok(tuples(run([[CRED_PATH, changed]], [entry])).some(([, , code]) => code === STALE));
    assert.deepEqual(tuples(run([[CRED_PATH, CRED_BYTES]], [entry])), [[CRED_PATH, 1, CRED_OK, 'info']]);
  });

  it('restores the strict finding when the entry is removed', () => {
    const entry = approval(CRED_PATH, 1, CRED_BYTES, CRED);
    assert.deepEqual(tuples(run([[CRED_PATH, CRED_BYTES]], [entry])), [[CRED_PATH, 1, CRED_OK, 'info']]);
    assert.deepEqual(tuples(run([[CRED_PATH, CRED_BYTES]], [])), [[CRED_PATH, 1, CRED, 'error']]);
  });
});

describe('checkEnvExampleReviews: unused approvals', () => {
  it('reports unused for a missing file', () => {
    const missing = approval('cfg/gone/.env.example', 4, CRED_BYTES, CRED, {
      blobOid: 'd'.repeat(40),
    });
    assert.deepEqual(tuples(run([], [missing])), [['cfg/gone/.env.example', 4, UNUSED, 'error']]);
  });

  it('reports unused when the blob matches but the finding is gone', () => {
    const quiet = Buffer.from('SYNTH_EB_OTHER=\n', 'utf8');
    const result = run([[OTHER_PATH, quiet]], [approval(OTHER_PATH, 1, quiet, VALUE)]);
    assert.deepEqual(tuples(result), [[OTHER_PATH, 1, UNUSED, 'error']]);
  });

  it('reports unused for a different line or finding code', () => {
    const wrongLine = run([[CRED_PATH, CRED_BYTES]], [approval(CRED_PATH, 3, CRED_BYTES, CRED)]);
    assert.deepEqual(tuples(wrongLine), [
      [CRED_PATH, 1, CRED, 'error'],
      [CRED_PATH, 3, UNUSED, 'error'],
    ]);
    const wrongCode = run([[CRED_PATH, CRED_BYTES]], [approval(CRED_PATH, 1, CRED_BYTES, VALUE)]);
    assert.deepEqual(tuples(wrongCode), [
      [CRED_PATH, 1, CRED, 'error'],
      [CRED_PATH, 1, UNUSED, 'error'],
    ]);
  });

  it('reports every stale and unused entry without silent skipping', () => {
    const changed = Buffer.from('SYNTH_EB_CRED=synth-token-d\n', 'utf8');
    const missing = approval('cfg/gone/.env.example', 2, CRED_BYTES, CRED, {
      blobOid: 'd'.repeat(40),
    });
    const result = run([[CRED_PATH, changed]], [approval(CRED_PATH, 1, CRED_BYTES, CRED), missing]);
    assert.ok(tuples(result).some(([, , code]) => code === STALE));
    assert.ok(tuples(result).some(([, , code]) => code === UNUSED));
  });
});

describe('checkEnvExampleReviews: non-waivable findings', () => {
  it('keeps syntax findings and reports unused for the same blob', () => {
    const broken = Buffer.from('SYNTH_EB_BROKEN\n', 'utf8');
    const result = run([[OTHER_PATH, broken]], [approval(OTHER_PATH, 1, broken, VALUE)]);
    assert.deepEqual(tuples(result), [
      [OTHER_PATH, 1, UNUSED, 'error'],
      [OTHER_PATH, 1, SYNTAX, 'error'],
    ]);
  });

  it('keeps duplicate findings when the duplicate line content is approved', () => {
    const doubled = Buffer.concat([OTHER_BYTES, OTHER_BYTES]);
    const result = run([[OTHER_PATH, doubled]], [approval(OTHER_PATH, 2, doubled, VALUE)]);
    assert.deepEqual(tuples(result), [
      [OTHER_PATH, 1, VALUE, 'error'],
      [OTHER_PATH, 2, DUPLICATE, 'error'],
      [OTHER_PATH, 2, VALUE_OK, 'info'],
    ]);
  });

  it('keeps invalid UTF-8 as a syntax finding without an exception', () => {
    const bytes = Buffer.from([0xff, 0x0a]);
    const result = run([[OTHER_PATH, bytes]], [approval(OTHER_PATH, 1, bytes, VALUE)]);
    assert.deepEqual(tuples(result), [
      [OTHER_PATH, 1, UNUSED, 'error'],
      [OTHER_PATH, 1, SYNTAX, 'error'],
    ]);
  });

  it('never decodes real env names with invalid bytes', () => {
    const result = run([['svc/.env.local', Buffer.from([0xff, 0x0a])]], []);
    assert.deepEqual(tuples(result), [['svc/.env.local', null, TRACKED, 'error']]);
  });

  it('keeps the prose scan info next to an accepted finding', () => {
    const mixed = Buffer.concat([Buffer.from('# synth prose note\n', 'utf8'), OTHER_BYTES]);
    const result = run([[OTHER_PATH, mixed]], [approval(OTHER_PATH, 2, mixed, VALUE)]);
    assert.deepEqual(tuples(result), [
      [OTHER_PATH, 1, PROSE, 'info'],
      [OTHER_PATH, 2, VALUE_OK, 'info'],
    ]);
  });
});

describe('checkEnvExampleReviews: fixed blob oracles', () => {
  it('anchors the builder with the empty blob oracle', () => {
    assert.equal(blobId(Buffer.alloc(0)), EMPTY_BLOB);
  });

  it('anchors the builder with the hello oracle', () => {
    assert.equal(blobId(Buffer.from('hello\n', 'utf8')), HELLO_BLOB);
  });

  it('uses blob identity even for an empty file', () => {
    const empty = Buffer.alloc(0);
    const matching = approval(OTHER_PATH, 1, empty, VALUE, { blobOid: EMPTY_BLOB });
    assert.deepEqual(tuples(run([[OTHER_PATH, empty]], [matching])), [[OTHER_PATH, 1, UNUSED, 'error']]);
    const wrong = { ...matching, blobOid: HELLO_BLOB };
    assert.deepEqual(tuples(run([[OTHER_PATH, empty]], [wrong])), [[OTHER_PATH, 1, STALE, 'error']]);
  });

  it('reports unused instead of stale for the hello oracle file', () => {
    const hello = Buffer.from('hello\n', 'utf8');
    const oraclePath = 'cfg/oracle/.env.example';
    const result = run([[oraclePath, hello]], [approval(oraclePath, 1, hello, VALUE)]);
    assert.ok(tuples(result).some(([, , code]) => code === UNUSED));
    assert.ok(!tuples(result).some(([, , code]) => code === STALE));
  });

  it('reports stale for a wrong blob on the oracle file', () => {
    const hello = Buffer.from('hello\n', 'utf8');
    const oraclePath = 'cfg/oracle/.env.example';
    const wrong = approval(oraclePath, 1, hello, VALUE, { blobOid: EMPTY_BLOB });
    const result = run([[oraclePath, hello]], [wrong]);
    assert.ok(tuples(result).some(([, , code]) => code === STALE));
  });
});

describe('checkEnvExampleReviews: register and call contract', () => {
  it('rejects a missing register', () => {
    const files = new Map();
    files.set(POLICY_PATH, policyBytes());
    files.set(CRED_PATH, CRED_BYTES);
    assertInvalid(() => checkEnvExampleReviews({ files, objectFormat: 'sha1' }));
  });

  it('rejects a defective register without marker leaks', () => {
    const marker = 'SYNTH_MARKER_EB7';
    const broken = Buffer.from(`{"broken":"${marker}"`, 'utf8');
    const files = filesMap([[CRED_PATH, CRED_BYTES]], []);
    files.set(REGISTER_PATH, broken);
    assertInvalid(() => checkEnvExampleReviews({ files, objectFormat: 'sha1' }), [marker]);
    const mistyped = Buffer.from(JSON.stringify({ schemaVersion: 1, objectFormat: 'sha1', approvals: marker }), 'utf8');
    files.set(REGISTER_PATH, mistyped);
    assertInvalid(() => checkEnvExampleReviews({ files, objectFormat: 'sha1' }), [marker]);
  });

  it('rejects register entries for non-waivable codes', () => {
    for (const code of [SYNTAX, DUPLICATE, TRACKED, PROSE]) {
      assertInvalid(() => run([[OTHER_PATH, OTHER_BYTES]], [approval(OTHER_PATH, 1, OTHER_BYTES, code)]));
    }
  });

  it('rejects objectFormat sha256', () => {
    assertInvalid(() => run([[CRED_PATH, CRED_BYTES]], [], 'sha256'));
    const files = filesMap([[CRED_PATH, CRED_BYTES]], []);
    files.set(
      REGISTER_PATH,
      Buffer.from(JSON.stringify({ schemaVersion: 1, objectFormat: 'sha256', approvals: [] }), 'utf8'),
    );
    assertInvalid(() => checkEnvExampleReviews({ files, objectFormat: 'sha256' }));
  });

  it('rejects invalid option and file shapes', () => {
    for (const options of [
      null,
      undefined,
      [],
      {},
      { files: filesMap([], []) },
      { files: 'x', objectFormat: 'sha1' },
      { files: [], objectFormat: 'sha1' },
      { files: filesMap([], []), objectFormat: 'SHA1' },
      { files: filesMap([], []), objectFormat: 1 },
      { files: filesMap([], []), objectFormat: null },
    ]) {
      assertInvalid(() => checkEnvExampleReviews(options));
    }
  });

  it('maps throwing option accessors to the failure', () => {
    assertFailed(() =>
      checkEnvExampleReviews({
        get files() {
          throw new Error('synth accessor');
        },
        objectFormat: 'sha1',
      }),
    );
    assertFailed(() =>
      checkEnvExampleReviews({
        files: filesMap([], []),
        get objectFormat() {
          throw new Error('synth accessor');
        },
      }),
    );
  });

  it('normalizes foreign map errors with faked codes', () => {
    const foreign = new Error(DATA_INVALID_MESSAGE);
    foreign.code = 'COMPLIANCE_DATA_INVALID';
    foreign.exitCode = 2;
    class FailingGetMap extends Map {
      get(key) {
        if (key === REGISTER_PATH) throw foreign;
        return super.get(key);
      }
    }
    const files = new FailingGetMap();
    files.set(POLICY_PATH, policyBytes());
    files.set(REGISTER_PATH, registerBytes([]));
    files.set(CRED_PATH, CRED_BYTES);
    assertFailed(() => checkEnvExampleReviews({ files, objectFormat: 'sha1' }));
  });

  it('preserves constant failures from the strict checker boundary', () => {
    class AlwaysFailingMap extends Map {
      get() {
        throw new Error('synth map failure');
      }
    }
    const hostile = new AlwaysFailingMap();
    hostile.set(POLICY_PATH, policyBytes());
    assert.throws(
      () => checkEnvExampleReviews({ files: hostile, objectFormat: 'sha1' }),
      (error) => {
        assert.equal(error.code, 'COMPLIANCE_ENV_EXAMPLE_FAILED');
        assert.equal(error.exitCode, 2);
        assert.ok(error.message === 'The check of the example templates failed.', 'unexpected strict error message');
        return true;
      },
    );
  });

  it('passes strict data errors through unchanged', () => {
    const files = filesMap([[CRED_PATH, CRED_BYTES]], []);
    files.delete(POLICY_PATH);
    assertInvalid(() => checkEnvExampleReviews({ files, objectFormat: 'sha1' }));
  });
});

describe('checkEnvExampleReviews: output shape and purity', () => {
  it('sorts issues by path, numeric line and code', () => {
    const padded = Buffer.concat([
      Buffer.from('\n', 'utf8'),
      CRED_BYTES,
      Buffer.from('\n'.repeat(7), 'utf8'),
      OTHER_BYTES,
    ]);
    const entries = [
      [CRED_PATH, Buffer.concat([CRED_BYTES, OTHER_BYTES])],
      ['a/.env.example', padded],
    ];
    assert.deepEqual(tuples(run(entries, [approval('a/.env.example', 10, padded, VALUE)])), [
      ['a/.env.example', 2, CRED, 'error'],
      ['a/.env.example', 10, VALUE_OK, 'info'],
      [CRED_PATH, 1, CRED, 'error'],
      [CRED_PATH, 2, VALUE, 'error'],
    ]);
  });

  it('is deterministic and never mutates its input', () => {
    const entries = [[CRED_PATH, CRED_BYTES]];
    const entry = approval(CRED_PATH, 1, CRED_BYTES, CRED);
    const files = filesMap(entries, [entry]);
    const keysBefore = [...files.keys()];
    const bytesBefore = new Map([...files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
    const first = checkEnvExampleReviews({ files, objectFormat: 'sha1' });
    const expected = JSON.parse(JSON.stringify(first));
    const second = checkEnvExampleReviews({ files, objectFormat: 'sha1' });
    assert.deepEqual(second, expected);
    assert.deepEqual([...files.keys()], keysBefore);
    for (const [name, bytes] of files) assert.ok(bytes.equals(bytesBefore.get(name)), 'input bytes changed');
    first.issues.push({ code: 'SYNTH_MUTATION', path: CRED_PATH, severity: 'error', line: 9 });
    first.records.length = 0;
    assert.deepEqual(second, expected);
    assert.deepEqual(checkEnvExampleReviews({ files, objectFormat: 'sha1' }), expected);
  });

  it('exposes exactly the public keys and unchanged records', () => {
    const entries = [[OTHER_PATH, OTHER_BYTES]];
    const result = run(entries, [approval(OTHER_PATH, 1, OTHER_BYTES, VALUE)]);
    for (const issue of result.issues) {
      assert.deepEqual(Object.keys(issue).sort(), ['code', 'line', 'path', 'severity']);
    }
    for (const record of result.records) {
      assert.deepEqual(Object.keys(record).sort(), ['kind', 'line', 'path']);
    }
    assert.deepEqual(result.records, strictResult(entries, []).records);
    assert.deepEqual(Object.keys(result).sort(), ['issues', 'records']);
  });

  it('leaks no metadata or raw values', () => {
    const entries = [[CRED_PATH, CRED_BYTES]];
    const entry = approval(CRED_PATH, 1, CRED_BYTES, CRED, { decisionRef: 'ENV-DECISION-777' });
    const dumped = JSON.stringify(run(entries, [entry]));
    for (const secret of [entry.blobOid, 'ENV-DECISION-777', 'ENV-DECISION-', 'synth-token-a']) {
      assert.ok(!dumped.includes(secret));
    }
  });

  it('keeps metadata and values out of real child streams', () => {
    const entry = approval(CRED_PATH, 1, CRED_BYTES, CRED, { decisionRef: 'ENV-DECISION-777' });
    const files = filesMap([[CRED_PATH, CRED_BYTES]], [entry]);
    const wire = JSON.stringify([...files].map(([name, bytes]) => [name, [...bytes]]));
    const moduleUrl = JSON.stringify(new URL('./env-example-reviews.mjs', import.meta.url).href);
    const probe = [
      'import { checkEnvExampleReviews } from ' + moduleUrl + ';',
      'const files = new Map(' + wire + '.map(([name, bytes]) => [name, Buffer.from(bytes)]));',
      "process.stdout.write(JSON.stringify(checkEnvExampleReviews({ files, objectFormat: 'sha1' })));",
    ].join('\n');
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
      env,
      encoding: 'utf8',
      timeout: 10000,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(child.status, 0);
    assert.ok(child.stderr === '', 'unexpected child stderr');
    let parsed;
    try {
      parsed = JSON.parse(child.stdout);
    } catch {
      assert.fail('unexpected child stdout');
    }
    assert.deepEqual(tuples(parsed), [[CRED_PATH, 1, CRED_OK, 'info']]);
    for (const marker of [entry.blobOid, entry.decisionRef, 'synth-token-a']) {
      assert.ok(!child.stdout.includes(marker), 'child stdout leaked input data');
      assert.ok(!child.stderr.includes(marker), 'child stderr leaked input data');
    }
  });

  it('maps severities to the documented outcome classes', () => {
    // No rc API exists on the module: errors mean rc 1, only infos mean rc 0,
    // constant exceptions with exitCode 2 mean rc 2 for a later layer.
    assert.deepEqual(run([[OTHER_PATH, Buffer.alloc(0)]], []).issues, []);
    const errors = run([[CRED_PATH, CRED_BYTES]], []).issues;
    assert.ok(errors.some((issue) => issue.severity === 'error'));
    assertInvalid(() => run([], [], 'sha256'));
  });
});
