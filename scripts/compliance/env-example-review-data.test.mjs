// Tests for the pure env example review data decoder.
//
// Fixtures are synthetic JSON bytes built in memory: no real template values
// are copied and no git blob is computed. Only this test file touches the
// file system to read the versioned empty register as a green fixture.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEnvExampleReviewDataError, parseEnvExampleReviewData } from './env-example-review-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const REGISTER_PATH = 'compliance/env-example-reviews.json';
const DATA_INVALID_MESSAGE = 'The compliance data is invalid.';
const REVIEW_FAILED_MESSAGE = 'The check of the example approvals failed.';
const SHA1_A = 'a'.repeat(40);
const SHA1_B = 'b'.repeat(40);
const SHA256_A = 'c'.repeat(64);
const CODES = [
  'ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED',
  'ENV_EXAMPLE_ADDRESS_REVIEW_REQUIRED',
  'ENV_EXAMPLE_VALUE_REVIEW_REQUIRED',
];

function baseEntry(over = {}) {
  return {
    path: 'config/.env.example',
    line: 3,
    blobOid: SHA1_A,
    code: 'ENV_EXAMPLE_CREDENTIAL_REVIEW_REQUIRED',
    approvedBy: 'user',
    decisionRef: 'ENV-DECISION-001',
    ...over,
  };
}

function registerBytes({ format = 'sha1', approvals = [], extraRoot = {}, raw = null } = {}) {
  if (raw !== null) return Buffer.from(raw, 'utf8');
  return Buffer.from(JSON.stringify({ schemaVersion: 1, objectFormat: format, approvals, ...extraRoot }), 'utf8');
}

function parse(bytes, objectFormat = 'sha1') {
  return parseEnvExampleReviewData({ bytes, objectFormat });
}

function assertInvalid(call, markers = []) {
  assert.throws(call, (error) => {
    assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
    assert.equal(error.exitCode, 2);
    assert.equal(error.message, DATA_INVALID_MESSAGE);
    assert.equal(isEnvExampleReviewDataError(error), true);
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
    assert.equal(error.message, REVIEW_FAILED_MESSAGE);
    assert.equal(isEnvExampleReviewDataError(error), true);
    return true;
  });
}

describe('parseEnvExampleReviewData: valid registers', () => {
  it('accepts an empty register for sha1', () => {
    const data = parse(registerBytes({ format: 'sha1', approvals: [] }), 'sha1');
    assert.deepEqual(data, { schemaVersion: 1, objectFormat: 'sha1', approvals: [] });
  });

  it('accepts an empty register for sha256', () => {
    const data = parse(registerBytes({ format: 'sha256', approvals: [] }), 'sha256');
    assert.deepEqual(data, { schemaVersion: 1, objectFormat: 'sha256', approvals: [] });
  });

  it('accepts every code, both roles and ENV-DECISION-000', () => {
    const approvals = [
      baseEntry({ line: 1, code: CODES[0], approvedBy: 'user', decisionRef: 'ENV-DECISION-000' }),
      baseEntry({ line: 2, code: CODES[1], approvedBy: 'project-lead', decisionRef: 'ENV-DECISION-010' }),
      baseEntry({ line: 3, code: CODES[2], approvedBy: 'user', decisionRef: 'ENV-DECISION-999' }),
    ];
    const data = parse(registerBytes({ approvals }), 'sha1');
    assert.equal(data.approvals.length, 3);
    assert.deepEqual(
      data.approvals.map((entry) => entry.code),
      CODES,
    );
  });

  it('accepts sha256 oids, nested basenames and the largest safe line', () => {
    const approvals = [
      {
        path: '.env.example',
        line: Number.MAX_SAFE_INTEGER,
        blobOid: SHA256_A,
        code: CODES[2],
        approvedBy: 'project-lead',
        decisionRef: 'ENV-DECISION-042',
      },
      {
        path: 'sub/dir/.env.prod.example',
        line: 1,
        blobOid: SHA256_A,
        code: CODES[0],
        approvedBy: 'user',
        decisionRef: 'ENV-DECISION-007',
      },
    ];
    const data = parse(registerBytes({ format: 'sha256', approvals }), 'sha256');
    assert.equal(data.approvals.length, 2);
  });

  it('sorts approvals by path, numeric line and code', () => {
    const first = baseEntry({
      path: 'b/.env.example',
      line: 10,
      blobOid: SHA1_B,
      code: CODES[2],
      approvedBy: 'project-lead',
      decisionRef: 'ENV-DECISION-003',
    });
    const second = baseEntry({
      path: 'a/.env.example',
      line: 2,
      blobOid: SHA1_A,
      code: CODES[0],
      approvedBy: 'user',
      decisionRef: 'ENV-DECISION-002',
    });
    const third = baseEntry({
      path: 'a/.env.example',
      line: 10,
      blobOid: SHA1_A,
      code: CODES[1],
      approvedBy: 'user',
      decisionRef: 'ENV-DECISION-001',
    });
    const data = parse(registerBytes({ approvals: [first, third, second] }), 'sha1');
    assert.deepEqual(
      data.approvals.map((entry) => [entry.path, entry.line, entry.code]),
      [
        ['a/.env.example', 2, CODES[0]],
        ['a/.env.example', 10, CODES[1]],
        ['b/.env.example', 10, CODES[2]],
      ],
    );
  });

  it('returns only the defined register fields', () => {
    const data = parse(registerBytes({ approvals: [baseEntry()] }), 'sha1');
    assert.deepEqual(Object.keys(data).sort(), ['approvals', 'objectFormat', 'schemaVersion']);
    assert.deepEqual(Object.keys(data.approvals[0]).sort(), [
      'approvedBy',
      'blobOid',
      'code',
      'decisionRef',
      'line',
      'path',
    ]);
  });

  it('parses the versioned empty register file', () => {
    const bytes = fs.readFileSync(path.join(REPO_ROOT, REGISTER_PATH));
    const data = parseEnvExampleReviewData({ bytes, objectFormat: 'sha1' });
    assert.deepEqual(data, { schemaVersion: 1, objectFormat: 'sha1', approvals: [] });
  });
});

describe('parseEnvExampleReviewData: invalid data', () => {
  it('rejects invalid arguments and byte-level defects', () => {
    const marker = 'SYNTH_MARKER_INVALID';
    for (const args of [
      null,
      undefined,
      [],
      {},
      { bytes: Buffer.from('{}', 'utf8') },
      { objectFormat: 'sha1' },
      { bytes: '{}', objectFormat: 'sha1' },
      { bytes: Buffer.from('{}', 'utf8'), objectFormat: 'SHA1' },
      { bytes: Buffer.from('{}', 'utf8'), objectFormat: 'sha1 ' },
    ]) {
      assertInvalid(() => parseEnvExampleReviewData(args), [marker]);
    }
    assertInvalid(() => parse(Buffer.from([0xff, 0x0a]), 'sha1'), [marker]);
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), registerBytes({ approvals: [] })]);
    assertInvalid(() => parse(bom, 'sha1'), [marker]);
    assertInvalid(() => parse(registerBytes({ raw: '{"schemaVersion":' }), 'sha1'), [marker]);
    for (const raw of ['null', '[]', '"x"']) {
      assertInvalid(() => parse(registerBytes({ raw }), 'sha1'), [marker]);
    }
  });

  it('rejects root shape defects and format mismatches', () => {
    const good = [baseEntry()];
    assertInvalid(() =>
      parse(registerBytes({ raw: JSON.stringify({ schemaVersion: 1, objectFormat: 'sha1' }) }), 'sha1'),
    );
    for (const extraRoot of [
      { schemaVersion: 0 },
      { schemaVersion: 2 },
      { schemaVersion: '1' },
      { approvals: null },
      { approvals: {} },
      { approvals: 'x' },
      { note: 'synth' },
    ]) {
      assertInvalid(() => parse(registerBytes({ approvals: good, extraRoot }), 'sha1'));
    }
    assertInvalid(() => parse(registerBytes({ format: 'sha256', approvals: [] }), 'sha1'));
    assertInvalid(() => parse(registerBytes({ format: 'sha1', approvals: [] }), 'sha256'));
  });

  it('rejects entry field defects', () => {
    for (const value of [
      '',
      '/a/.env.example',
      'a\\.env.example',
      'a/.env.example/',
      'a//.env.example',
      './.env.example',
      'a/../.env.example',
      'a/.env',
      'a/.env.local',
      'a/.ENV.EXAMPLE',
      'a/.env.example.bak',
      'a/foo.env.example',
      'a/*.env.example',
      `a${String.fromCharCode(1)}/.env.example`,
      `a${String.fromCharCode(127)}/.env.example`,
      `a${String.fromCharCode(128)}/.env.example`,
      `a${String.fromCharCode(8232)}/.env.example`,
    ]) {
      assertInvalid(() => parse(registerBytes({ approvals: [baseEntry({ path: value })] }), 'sha1'));
    }
    for (const value of [0, -1, 1.5, '3', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
      assertInvalid(() => parse(registerBytes({ approvals: [baseEntry({ line: value })] }), 'sha1'));
    }
    for (const value of [
      'a'.repeat(39),
      'a'.repeat(41),
      'A'.repeat(40),
      'g'.repeat(40),
      'c'.repeat(64),
      123,
      undefined,
    ]) {
      assertInvalid(() => parse(registerBytes({ approvals: [baseEntry({ blobOid: value })] }), 'sha1'));
    }
    assert.deepEqual(
      parse(registerBytes({ format: 'sha256', approvals: [baseEntry({ blobOid: SHA256_A })] }), 'sha256'),
      {
        schemaVersion: 1,
        objectFormat: 'sha256',
        approvals: [baseEntry({ blobOid: SHA256_A })],
      },
    );
    for (const value of ['c'.repeat(63), 'c'.repeat(65), 'C'.repeat(64), SHA1_A, undefined]) {
      assertInvalid(() =>
        parse(registerBytes({ format: 'sha256', approvals: [baseEntry({ blobOid: value })] }), 'sha256'),
      );
    }
    for (const value of [
      'ENV_EXAMPLE_SYNTAX_UNSUPPORTED',
      'ENV_EXAMPLE_CREDENTIAL_REVIEW_ACCEPTED',
      'env_example_value_review_required',
      undefined,
      null,
    ]) {
      assertInvalid(() => parse(registerBytes({ approvals: [baseEntry({ code: value })] }), 'sha1'));
    }
    for (const value of ['agent', 'Admin', '', undefined]) {
      assertInvalid(() => parse(registerBytes({ approvals: [baseEntry({ approvedBy: value })] }), 'sha1'));
    }
    for (const value of [
      'ENV-DECISION-01',
      'ENV-DECISION-0001',
      'ENV-DECISION-ABC',
      'ENVDECISION-001',
      'ENV-DECISION-001 ',
      'env-decision-001',
      undefined,
    ]) {
      assertInvalid(() => parse(registerBytes({ approvals: [baseEntry({ decisionRef: value })] }), 'sha1'));
    }
    assertInvalid(() => parse(registerBytes({ approvals: [baseEntry({ reason: 'synth' })] }), 'sha1'));
    for (const approvals of [[null], ['x'], [[]]]) {
      assertInvalid(() => parse(registerBytes({ approvals }), 'sha1'));
    }
  });

  it('rejects duplicate targets and conflicting blob bindings', () => {
    assertInvalid(() => parse(registerBytes({ approvals: [baseEntry(), baseEntry()] }), 'sha1'));
    const conflict = baseEntry({ line: 9, blobOid: SHA1_B });
    assertInvalid(() => parse(registerBytes({ approvals: [baseEntry(), conflict] }), 'sha1'));
  });
});

describe('parseEnvExampleReviewData: failures and error identity', () => {
  it('maps throwing accessors to the failed error', () => {
    const bytes = registerBytes({ approvals: [] });
    assertFailed(() =>
      parseEnvExampleReviewData({
        get bytes() {
          throw new Error('synth accessor');
        },
        objectFormat: 'sha1',
      }),
    );
    assertFailed(() =>
      parseEnvExampleReviewData({
        bytes,
        get objectFormat() {
          throw new Error('synth accessor');
        },
      }),
    );
  });

  it('normalizes foreign errors with faked codes', () => {
    const foreignData = new Error(DATA_INVALID_MESSAGE);
    foreignData.code = 'COMPLIANCE_DATA_INVALID';
    foreignData.exitCode = 2;
    assert.equal(isEnvExampleReviewDataError(foreignData), false);
    const foreignFailed = new Error(REVIEW_FAILED_MESSAGE);
    foreignFailed.code = 'COMPLIANCE_ENV_EXAMPLE_REVIEW_FAILED';
    foreignFailed.exitCode = 2;
    assert.equal(isEnvExampleReviewDataError(foreignFailed), false);
    assertFailed(() =>
      parseEnvExampleReviewData({
        get bytes() {
          throw foreignData;
        },
        objectFormat: 'sha1',
      }),
    );
  });

  it('rejects non-module values in the identity check', () => {
    for (const value of [null, undefined, 'x', 42, {}, new Error('synth'), { code: 'COMPLIANCE_DATA_INVALID' }]) {
      assert.equal(isEnvExampleReviewDataError(value), false);
    }
  });
});

describe('parseEnvExampleReviewData: determinism and purity', () => {
  it('is deterministic and never mutates its input', () => {
    const approvals = [
      baseEntry({
        path: 'b/.env.example',
        line: 4,
        blobOid: SHA1_B,
        code: CODES[2],
        decisionRef: 'ENV-DECISION-005',
      }),
      baseEntry({
        path: 'a/.env.example',
        line: 1,
        blobOid: SHA1_A,
        code: CODES[0],
        decisionRef: 'ENV-DECISION-004',
      }),
    ];
    const bytes = registerBytes({ approvals });
    const snapshot = Buffer.from(bytes);
    const first = parse(bytes, 'sha1');
    const second = parse(bytes, 'sha1');
    assert.deepEqual(first, second);
    assert.ok(bytes.equals(snapshot));
    first.approvals.push(baseEntry({ path: 'c/.env.example', line: 1, blobOid: SHA1_B }));
    first.approvals[0].line = 999;
    const third = parse(bytes, 'sha1');
    assert.deepEqual(third, second);
  });

  it('leaks no markers into error messages', () => {
    const marker = 'SYNTH_MARKER_ZZ9';
    assertInvalid(() => parse(registerBytes({ approvals: [baseEntry({ reason: marker })] }), 'sha1'), [marker]);
    assertInvalid(() => parse(registerBytes({ raw: `{"synth":"${marker}"}` }), 'sha1'), [marker]);
  });
});
