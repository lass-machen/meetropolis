import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateLicenseExpression } from './license-expression.mjs';

const MIT_ONLY = ['MIT'];

describe('evaluateLicenseExpression', () => {
  it('accepts a single allowed id', () => {
    assert.deepEqual(evaluateLicenseExpression('MIT', MIT_ONLY), {
      ok: true,
      selected: ['MIT'],
      code: null,
    });
  });

  it('rejects a single id that is not allowed', () => {
    assert.deepEqual(evaluateLicenseExpression('GPL-3.0-or-later', MIT_ONLY), {
      ok: false,
      selected: [],
      code: 'LICENSE_NOT_ALLOWED',
    });
  });

  it('rejects unknown ids without alias normalization', () => {
    // Apache-2 must NOT normalize to Apache-2.0.
    const res = evaluateLicenseExpression('Apache-2', ['Apache-2.0']);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'LICENSE_NOT_ALLOWED');
    assert.deepEqual(res.selected, []);
  });

  it('AND requires both sides', () => {
    assert.equal(evaluateLicenseExpression('MIT AND ISC', ['MIT', 'ISC']).ok, true);
    const res = evaluateLicenseExpression('MIT AND ISC', MIT_ONLY);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'LICENSE_NOT_ALLOWED');
  });

  it('AND binds tighter than OR', () => {
    // ISC OR MIT AND GPL-3.0-or-later == ISC OR (MIT AND GPL-3.0-or-later)
    const allowed = ['ISC', 'MIT'];
    const res = evaluateLicenseExpression('ISC OR MIT AND GPL-3.0-or-later', allowed);
    assert.equal(res.ok, true);
    assert.deepEqual(res.selected, ['ISC']);
  });

  it('parentheses override precedence', () => {
    const res = evaluateLicenseExpression('(ISC OR MIT) AND MIT', ['ISC', 'MIT']);
    assert.equal(res.ok, true);
    assert.deepEqual(res.selected, ['ISC', 'MIT']);
  });

  it('OR picks the first fully allowed branch', () => {
    const res = evaluateLicenseExpression('GPL-3.0-or-later OR MIT OR ISC', ['MIT', 'ISC']);
    assert.equal(res.ok, true);
    assert.deepEqual(res.selected, ['MIT']);
  });

  it('MIT OR GPL-3.0-or-later is satisfiable via MIT', () => {
    const res = evaluateLicenseExpression('(MIT OR GPL-3.0-or-later)', MIT_ONLY);
    assert.equal(res.ok, true);
    assert.deepEqual(res.selected, ['MIT']);
  });

  it('MIT AND GPL-3.0-or-later is not satisfiable', () => {
    const res = evaluateLicenseExpression('(MIT AND GPL-3.0-or-later)', MIT_ONLY);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'LICENSE_NOT_ALLOWED');
  });

  it('sorts and deduplicates selected ids', () => {
    const res = evaluateLicenseExpression('Zlib AND MIT AND MIT', ['MIT', 'Zlib']);
    assert.equal(res.ok, true);
    assert.deepEqual(res.selected, ['MIT', 'Zlib']);
  });

  it('parses WITH but never allows it', () => {
    const res = evaluateLicenseExpression('GPL-2.0-only WITH Classpath-exception-2.0', ['GPL-2.0-only']);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'LICENSE_NOT_ALLOWED');
  });

  it('rejects lowercase operators as invalid', () => {
    const res = evaluateLicenseExpression('MIT and ISC', ['MIT', 'ISC']);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'LICENSE_EXPRESSION_INVALID');
  });

  it('rejects empty and malformed expressions as invalid', () => {
    for (const expr of ['', '   ', '(MIT', 'MIT)', 'MIT OR', 'AND MIT', '(MIT OR)']) {
      const res = evaluateLicenseExpression(expr, MIT_ONLY);
      assert.equal(res.ok, false, expr);
      assert.equal(res.code, 'LICENSE_EXPRESSION_INVALID', expr);
      assert.deepEqual(res.selected, [], expr);
    }
  });

  it('is case-sensitive for license ids', () => {
    const res = evaluateLicenseExpression('mit', MIT_ONLY);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'LICENSE_NOT_ALLOWED');
  });

  it('rejects tokens with illegal characters as invalid', () => {
    for (const expr of ['MIT$ OR MIT', 'MIT WITH bad$exception OR MIT', 'MIT++', '+MIT', 'MI T']) {
      const res = evaluateLicenseExpression(expr, MIT_ONLY);
      assert.equal(res.ok, false, expr);
      assert.equal(res.code, 'LICENSE_EXPRESSION_INVALID', expr);
      assert.deepEqual(res.selected, [], expr);
    }
  });

  it('accepts a syntactically correct trailing plus verbatim', () => {
    const res = evaluateLicenseExpression('GPL-2.0+', ['GPL-2.0+']);
    assert.equal(res.ok, true);
    assert.deepEqual(res.selected, ['GPL-2.0+']);
    const other = evaluateLicenseExpression('GPL-2.0+', ['GPL-2.0']);
    assert.equal(other.ok, false);
    assert.equal(other.code, 'LICENSE_NOT_ALLOWED');
  });

  it('parses LicenseRef but keeps it red without policy allowance', () => {
    const res = evaluateLicenseExpression('LicenseRef-Example OR MIT', MIT_ONLY);
    assert.equal(res.ok, true);
    assert.deepEqual(res.selected, ['MIT']);
    const alone = evaluateLicenseExpression('LicenseRef-Example', MIT_ONLY);
    assert.equal(alone.ok, false);
    assert.equal(alone.code, 'LICENSE_NOT_ALLOWED');
  });

  it('parses DocumentRef:LicenseRef but keeps it red without policy allowance', () => {
    const res = evaluateLicenseExpression('DocumentRef-spdx-tool-1.2:LicenseRef-Missing-1.2', ['MIT']);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'LICENSE_NOT_ALLOWED');
  });
});
