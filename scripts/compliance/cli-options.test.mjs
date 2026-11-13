// Tests for the deterministic license gate argument parser.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseLicenseGateArgs } from './cli-options.mjs';

const SHA40 = 'b1e42dca212355b65de7f697bc9eeff9859babac';
const SHA64 = 'b1e42dca212355b65de7f697bc9eeff9859babac0123456789abcdef01234567';

function fails(argv) {
  return assert.throws(
    () => parseLicenseGateArgs(argv),
    (error) => {
      assert.equal(error.code, 'COMPLIANCE_ARGUMENTS_INVALID');
      assert.equal(error.exitCode, 2);
      assert.ok(error instanceof Error);
      assert.equal(error instanceof TypeError, false);
      assert.match(error.message, /Usage/);
      return true;
    },
  );
}

describe('parseLicenseGateArgs', () => {
  it('parses a range with merge-base and head', () => {
    assert.deepEqual(parseLicenseGateArgs(['--range', '1402ee5..b1e42dc']), {
      mode: 'range',
      range: '1402ee5..b1e42dc',
      commit: null,
      jsonPath: null,
    });
  });

  it('parses all without a commit', () => {
    assert.deepEqual(parseLicenseGateArgs(['--all']), {
      mode: 'all',
      range: null,
      commit: null,
      jsonPath: null,
    });
  });

  it('parses all with a 40 character commit', () => {
    assert.deepEqual(parseLicenseGateArgs(['--all', '--commit', SHA40]), {
      mode: 'all',
      range: null,
      commit: SHA40,
      jsonPath: null,
    });
  });

  it('parses all with a 64 character commit', () => {
    assert.deepEqual(parseLicenseGateArgs(['--all', '--commit', SHA64]), {
      mode: 'all',
      range: null,
      commit: SHA64,
      jsonPath: null,
    });
  });

  it('keeps json paths with spaces, unicode and absolute paths', () => {
    assert.equal(
      parseLicenseGateArgs(['--range', 'a..b', '--json', 'reports/audit report.json']).jsonPath,
      'reports/audit report.json',
    );
    assert.equal(parseLicenseGateArgs(['--all', '--json', '/tmp/x.json']).jsonPath, '/tmp/x.json');
    assert.equal(parseLicenseGateArgs(['--all', '--json', 'o.json']).jsonPath, 'o.json');
  });

  it('accepts flags in any order', () => {
    assert.deepEqual(parseLicenseGateArgs(['--json', 'o.json', '--all']), {
      mode: 'all',
      range: null,
      commit: null,
      jsonPath: 'o.json',
    });
    assert.deepEqual(parseLicenseGateArgs(['--json', 'o.json', '--range', 'a..b']), {
      mode: 'range',
      range: 'a..b',
      commit: null,
      jsonPath: 'o.json',
    });
  });

  it('does not modify the input array', () => {
    const argv = ['--all', '--commit', SHA40, '--json', 'o.json'];
    const before = JSON.stringify(argv);
    parseLicenseGateArgs(argv);
    assert.equal(JSON.stringify(argv), before);
  });

  it('rejects a missing or conflicting mode', () => {
    fails([]);
    fails(['--all', '--range', 'a..b']);
    fails(['--range', 'a..b', '--all']);
  });

  it('rejects commit with range or without all', () => {
    fails(['--range', 'a..b', '--commit', SHA40]);
    fails(['--commit', SHA40]);
  });

  it('rejects every duplicated flag', () => {
    fails(['--all', '--all']);
    fails(['--range', 'a..b', '--range', 'a..b']);
    fails(['--all', '--commit', SHA40, '--commit', SHA40]);
    fails(['--all', '--json', 'a.json', '--json', 'a.json']);
  });

  it('rejects unknown flags, positionals, equal syntax and help', () => {
    fails(['--all', '--verbose']);
    fails(['--all', 'extra']);
    fails(['extra']);
    fails(['--range=a..b']);
    fails(['--help']);
    fails(['--all', '--help']);
  });

  it('rejects missing, empty, whitespace, control and dash values', () => {
    fails(['--range']);
    fails(['--all', '--commit']);
    fails(['--all', '--json']);
    fails(['--range', '']);
    fails(['--range', '   ']);
    fails(['--range', 'a\x00..b']);
    fails(['--range', 'a\x7f..b']);
    fails(['--json', '-out.json']);
    fails(['--range', '-a..b']);
  });

  it('rejects malformed ranges', () => {
    fails(['--range', '..b']);
    fails(['--range', 'a..']);
    fails(['--range', '..']);
    fails(['--range', 'a..b..c']);
    fails(['--range', 'a...b']);
    fails(['--range', 'a..b c']);
    fails(['--range', 'a ..b']);
  });

  it('rejects short, invalid and uppercase commits', () => {
    fails(['--all', '--commit', SHA40.slice(0, 39)]);
    fails(['--all', '--commit', 'x'.repeat(40)]);
    fails(['--all', '--commit', SHA40.toUpperCase()]);
    fails(['--all', '--commit', SHA64.slice(0, 63)]);
  });

  it('rejects non-array, non-string and sparse input', () => {
    fails();
    fails('x');
    fails(null);
    fails(['--all', 5]);
    const sparse = ['--all'];
    sparse.length = 2;
    fails(sparse);
  });

  it('keeps error messages free of input values', () => {
    const marker = 'SECRET-VALUE-XYZ';
    try {
      parseLicenseGateArgs(['--range', marker]);
      assert.fail('expected an error');
    } catch (error) {
      assert.equal(error.code, 'COMPLIANCE_ARGUMENTS_INVALID');
      assert.equal(error.exitCode, 2);
      assert.ok(!error.message.includes(marker));
      assert.ok(!('cause' in error) || error.cause === undefined);
    }
  });
});
