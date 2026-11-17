import { describe, expect, it } from 'vitest';
import { parseMaxCopyLifetimeDays } from './tenantDeletionJournal.js';
import * as planning from './tenantDeletionPlanning.js';
import { journalUntilFor } from './tenantDeletionPlanning.js';

// Copy-lifetime parsing and journal expiry. Both helpers stay pure: no file
// access, no process environment, only the given values decide the result.

describe('parseMaxCopyLifetimeDays', () => {
  it.each([
    ['30', 30],
    [' 30 ', 30],
    ['1', 1],
    ['99999', 99999],
  ])('accepts %j as %d', (value, expected) => {
    expect(parseMaxCopyLifetimeDays(value)).toBe(expected);
  });

  it('accepts the number 14', () => {
    expect(parseMaxCopyLifetimeDays(14)).toBe(14);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['zero string', '0'],
    ['leading zero', '030'],
    ['decimal string', '1.5'],
    ['negative string', '-3'],
    ['too large string', '100000'],
    ['letters', 'abc'],
    ['zero number', 0],
    ['decimal number', 1.5],
    ['not a number', NaN],
    ['infinite', Infinity],
    ['null', null],
    ['object', {}],
  ])('rejects %s', (_label, value) => {
    expect(parseMaxCopyLifetimeDays(value)).toBeUndefined();
  });
});

describe('journalUntilFor', () => {
  const dayMs = 86_400_000;
  const transactionMs = new Date('2026-11-01T00:00:00.000Z').getTime();

  it('adds 30 days for a 30 day lifetime with 7 day retention', () => {
    expect(journalUntilFor(transactionMs, '30', '7')).toEqual(new Date(transactionMs + 30 * dayMs));
  });

  it('adds 7 days when lifetime equals retention', () => {
    expect(journalUntilFor(transactionMs, '7', '7')).toEqual(new Date(transactionMs + 7 * dayMs));
  });

  it.each([
    ['missing lifetime', undefined, '7'],
    ['invalid lifetime', 'abc', '7'],
    ['invalid retention', '30', 'Marker-Invalid'],
    ['lifetime below retention', '6', '7'],
  ])('returns undefined for %s', (_label, lifetime, retention) => {
    expect(journalUntilFor(transactionMs, lifetime, retention)).toBeUndefined();
  });

  it('no longer exposes a fixed copy lifetime constant', () => {
    expect('TENANT_DELETION_JOURNAL_MAX_COPY_LIFETIME_MS' in planning).toBe(false);
  });
});
