// Commit sign-off compliance tests (synthetic fixtures only).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkCommitSignoffs } from './commits.mjs';

const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);
const OID_C = 'c'.repeat(40);
const OID_D = 'd'.repeat(40);
const OID_E = 'e'.repeat(40);
const OID_F = 'f'.repeat(40);
const OID_G64 = '0123456789abcdef'.repeat(4);

function commit(oid, author, trailers) {
  return { oid, author: { ...author }, trailers: trailers.map((t) => ({ ...t })) };
}

function snapshotOf(value) {
  return JSON.stringify(value);
}

describe('checkCommitSignoffs: matching sign-off', () => {
  it('accepts an external contributor with a matching sign-off', () => {
    const input = {
      commits: [
        commit(OID_A, { name: 'Ada Example', email: 'ada.example@example.org' }, [
          { key: 'Signed-off-by', value: 'Ada Example <ada.example@example.org>' },
        ]),
      ],
    };
    const result = checkCommitSignoffs(input);
    assert.deepEqual(result, {
      records: [{ commit: OID_A, hasSignoff: true, authorMatched: true }],
      issues: [],
    });
  });

  it('accepts one matching sign-off next to foreign and malformed ones', () => {
    const input = {
      commits: [
        commit(OID_A, { name: 'Ada Example', email: 'ada.example@example.org' }, [
          { key: 'Signed-off-by', value: 'Foreign Person <foreign@example.org>' },
          { key: 'Signed-off-by', value: 'not a trailer at all' },
          { key: 'Signed-off-by', value: 'Ada Example <ada.example@example.org>' },
        ]),
      ],
    };
    const result = checkCommitSignoffs(input);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.records, [{ commit: OID_A, hasSignoff: true, authorMatched: true }]);
  });
});

describe('checkCommitSignoffs: missing and mismatched sign-offs', () => {
  it('reports COMMIT_SIGNOFF_MISSING without any sign-off key', () => {
    const input = {
      commits: [commit(OID_A, { name: 'Ada Example', email: 'ada@example.org' }, [])],
    };
    const result = checkCommitSignoffs(input);
    assert.deepEqual(result.records, [{ commit: OID_A, hasSignoff: false, authorMatched: false }]);
    assert.deepEqual(result.issues, [{ severity: 'error', code: 'COMMIT_SIGNOFF_MISSING', commit: OID_A }]);
  });

  it('reports COMMIT_SIGNOFF_MISSING when only unknown trailers exist', () => {
    const input = {
      commits: [
        commit(OID_A, { name: 'Ada Example', email: 'ada@example.org' }, [
          { key: 'Reviewed-by', value: 'Ada Example <ada@example.org>' },
          { key: 'Co-authored-by', value: 'Ada Example <ada@example.org>' },
        ]),
      ],
    };
    const result = checkCommitSignoffs(input);
    assert.deepEqual(result.issues, [{ severity: 'error', code: 'COMMIT_SIGNOFF_MISSING', commit: OID_A }]);
    assert.deepEqual(result.records, [{ commit: OID_A, hasSignoff: false, authorMatched: false }]);
  });

  it('reports COMMIT_SIGNOFF_AUTHOR_MISMATCH for a foreign name', () => {
    const input = {
      commits: [
        commit(OID_A, { name: 'Ada Example', email: 'ada@example.org' }, [
          { key: 'Signed-off-by', value: 'Foreign Person <ada@example.org>' },
        ]),
      ],
    };
    const result = checkCommitSignoffs(input);
    assert.deepEqual(result.records, [{ commit: OID_A, hasSignoff: true, authorMatched: false }]);
    assert.deepEqual(result.issues, [{ severity: 'error', code: 'COMMIT_SIGNOFF_AUTHOR_MISMATCH', commit: OID_A }]);
  });

  it('reports COMMIT_SIGNOFF_AUTHOR_MISMATCH for a foreign mail', () => {
    const input = {
      commits: [
        commit(OID_A, { name: 'Ada Example', email: 'ada@example.org' }, [
          { key: 'Signed-off-by', value: 'Ada Example <foreign@example.org>' },
        ]),
      ],
    };
    const result = checkCommitSignoffs(input);
    assert.deepEqual(result.issues, [{ severity: 'error', code: 'COMMIT_SIGNOFF_AUTHOR_MISMATCH', commit: OID_A }]);
  });

  it('treats malformed and suffixed values as non-matching', () => {
    const malformed = [
      'Ada Example ada@example.org',
      'Ada Example <ada@example.org> extra',
      'Ada Example <>',
      '<ada@example.org>',
      '',
    ];
    for (const value of malformed) {
      const input = {
        commits: [commit(OID_A, { name: 'Ada Example', email: 'ada@example.org' }, [{ key: 'Signed-off-by', value }])],
      };
      const result = checkCommitSignoffs(input);
      assert.deepEqual(result.issues, [{ severity: 'error', code: 'COMMIT_SIGNOFF_AUTHOR_MISMATCH', commit: OID_A }]);
    }
  });
});

describe('checkCommitSignoffs: normalization', () => {
  it('matches keys and mails case-insensitively', () => {
    const input = {
      commits: [
        commit(OID_A, { name: 'Ada Example', email: 'ada@example.org' }, [
          { key: 'SIGNED-OFF-BY', value: 'Ada Example <ADA@EXAMPLE.ORG>' },
        ]),
      ],
    };
    const result = checkCommitSignoffs(input);
    assert.deepEqual(result.issues, []);
    assert.equal(result.records[0].authorMatched, true);
  });

  it('normalizes NFC umlauts and collapses spaces and tabs in names', () => {
    const decomposed = 'Ju\u0308rgen Mo\u0308ller';
    const input = {
      commits: [
        commit(OID_A, { name: decomposed, email: 'juergen@example.org' }, [
          { key: 'signed-off-by', value: 'Jürgen\t Möller <juergen@example.org>' },
        ]),
      ],
    };
    const result = checkCommitSignoffs(input);
    assert.deepEqual(result.issues, []);
    assert.equal(result.records[0].authorMatched, true);
  });

  it('compares names case-sensitively without a lower-case fallback', () => {
    const input = {
      commits: [
        commit(OID_A, { name: 'Ada Example', email: 'ada@example.org' }, [
          { key: 'Signed-off-by', value: 'ada example <ada@example.org>' },
        ]),
      ],
    };
    const result = checkCommitSignoffs(input);
    assert.deepEqual(result.issues, [{ severity: 'error', code: 'COMMIT_SIGNOFF_AUTHOR_MISMATCH', commit: OID_A }]);
  });
});

describe('checkCommitSignoffs: shape guarantees', () => {
  it('returns green for an empty commit list', () => {
    assert.deepEqual(checkCommitSignoffs({ commits: [] }), { records: [], issues: [] });
  });

  it('sorts deterministically by oid and never mutates the input', () => {
    const input = {
      commits: [
        commit(OID_C, { name: 'Ces Example', email: 'ces@example.org' }, []),
        commit(OID_A, { name: 'Ada Example', email: 'ada@example.org' }, []),
        commit(OID_B, { name: 'Bea Example', email: 'bea@example.org' }, [
          { key: 'Signed-off-by', value: 'Bea Example <bea@example.org>' },
        ]),
      ],
    };
    const before = snapshotOf(input);
    const result = checkCommitSignoffs(input);
    assert.deepEqual(
      result.records.map((r) => r.commit),
      [OID_A, OID_B, OID_C],
    );
    assert.deepEqual(
      result.issues.map((i) => i.commit),
      [OID_A, OID_C],
    );
    assert.equal(snapshotOf(input), before);
  });

  it('accepts 64-hex-digit oids', () => {
    const input = {
      commits: [
        commit(OID_G64, { name: 'Ada Example', email: 'ada@example.org' }, [
          { key: 'Signed-off-by', value: 'Ada Example <ada@example.org>' },
        ]),
      ],
    };
    const result = checkCommitSignoffs(input);
    assert.deepEqual(result.issues, []);
  });

  it('exposes only oids, booleans, severity and codes', () => {
    const input = {
      commits: [
        commit(OID_B, { name: 'Bea Secret', email: 'bea.secret@example.org' }, []),
        commit(OID_A, { name: 'Ada Secret', email: 'ada.secret@example.org' }, [
          { key: 'Signed-off-by', value: 'Foreign <foreign@example.org>' },
        ]),
      ],
    };
    const result = checkCommitSignoffs(input);
    const dumped = JSON.stringify(result);
    assert.equal(dumped.includes('Secret'), false);
    assert.equal(dumped.includes('secret@example.org'), false);
    assert.equal(dumped.includes('Foreign'), false);
    assert.deepEqual(Object.keys(result).sort(), ['issues', 'records']);
    for (const record of result.records) {
      assert.deepEqual(Object.keys(record).sort(), ['authorMatched', 'commit', 'hasSignoff']);
    }
    for (const issue of result.issues) {
      assert.deepEqual(Object.keys(issue).sort(), ['code', 'commit', 'severity']);
    }
  });
});

describe('checkCommitSignoffs: invalid data', () => {
  it('throws one constant non-leaking error for every invalid shape', () => {
    const marker = ' Lard-Marker ';
    const badOid = 'Z'.repeat(40);
    const validAuthor = { name: 'Ada Example', email: 'ada@example.org' };
    const validTrailers = [{ key: 'Signed-off-by', value: 'Ada Example <ada@example.org>' }];
    const sparseCommits = new Array(1);
    const sparseTrailers = new Array(1);

    const cases = [
      undefined,
      null,
      'junk',
      {},
      { commits: null },
      { commits: {} },
      { commits: sparseCommits },
      { commits: [null] },
      { commits: ['junk'] },
      { commits: [commit(OID_A, validAuthor, validTrailers), commit(OID_A, validAuthor, validTrailers)] },
      { commits: [commit('abc', validAuthor, validTrailers)] },
      { commits: [commit(OID_A.toUpperCase(), validAuthor, validTrailers)] },
      { commits: [commit(badOid, validAuthor, validTrailers)] },
      { commits: [commit(marker + OID_B.slice(marker.length), validAuthor, validTrailers)] },
      { commits: [commit(OID_A, { name: '', email: 'ada@example.org' }, validTrailers)] },
      { commits: [commit(OID_A, { name: 'Ada\nBeispiel', email: 'ada@example.org' }, validTrailers)] },
      { commits: [commit(OID_A, { name: '   ', email: 'ada@example.org' }, validTrailers)] },
      { commits: [commit(OID_A, { name: 'Ada Example', email: '' }, validTrailers)] },
      { commits: [commit(OID_A, { name: 'Ada Example', email: 'no-at-sign' }, validTrailers)] },
      { commits: [commit(OID_A, { name: 'Ada Example', email: 'a@b@c' }, validTrailers)] },
      { commits: [commit(OID_A, { name: 'Ada Example', email: 'a d@example.org' }, validTrailers)] },
      { commits: [commit(OID_A, { name: 'Ada Example', email: 'a<d@example.org>' }, validTrailers)] },
      { commits: [commit(OID_A, { name: 'Ada Example', email: marker }, validTrailers)] },
      { commits: [{ oid: OID_A, author: { ...validAuthor }, trailers: null }] },
      { commits: [commit(OID_A, validAuthor, sparseTrailers)] },
      { commits: [commit(OID_A, validAuthor, [{ key: 'Bad Key', value: 'x' }])] },
      { commits: [commit(OID_A, validAuthor, [{ key: '', value: 'x' }])] },
      { commits: [commit(OID_A, validAuthor, [{ key: 'Signed-off-by', value: 'a\nb' }])] },
      { commits: [{ oid: OID_D, author: validAuthor }] },
      { commits: [commit(OID_E, null, validTrailers)] },
      { commits: [commit(OID_F, validAuthor, [{ key: 'Signed-off-by' }])] },
    ];

    const messages = new Set();
    for (const input of cases) {
      assert.throws(
        () => checkCommitSignoffs(input),
        (error) => {
          assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
          assert.equal(typeof error.message, 'string');
          assert.equal(error.message.includes(marker.trim()), false);
          assert.equal(error.message.includes(badOid), false);
          messages.add(error.message);
          return true;
        },
      );
    }
    assert.deepEqual([...messages], [DATA_INVALID_MESSAGE]);
  });
});
