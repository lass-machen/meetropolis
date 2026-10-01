import { describe, expect, it } from 'vitest';
import { clientNumberForLog, clientStringForLog, MAX_LOGGED_CLIENT_STRING } from './logSafe.js';

describe('clientStringForLog', () => {
  it('keeps a short string, umlauts and an empty string unchanged', () => {
    expect(clientStringForLog('user-1')).toBe('user-1');
    expect(clientStringForLog('Jörg Müller-Lüdenscheidt')).toBe('Jörg Müller-Lüdenscheidt');
    expect(clientStringForLog('')).toBe('');
  });

  it('keeps a string of exactly the limit unchanged', () => {
    const atLimit = 'a'.repeat(MAX_LOGGED_CLIENT_STRING);
    expect(clientStringForLog(atLimit)).toBe(atLimit);
  });

  it('cuts a string above the limit to the limit and reports the original length', () => {
    const logged = clientStringForLog('a'.repeat(MAX_LOGGED_CLIENT_STRING + 1));
    expect(logged).toBe(`${'a'.repeat(MAX_LOGGED_CLIENT_STRING)}... (${MAX_LOGGED_CLIENT_STRING + 1} chars)`);
  });

  it('bounds a 900,000 character string', () => {
    const logged = clientStringForLog('x'.repeat(900_000));
    expect(logged.length).toBeLessThan(120);
    expect(logged).toContain('(900000 chars)');
  });

  it.each([
    ['a number', 7, '<number>'],
    ['an object', { a: 1 }, '<object>'],
    ['null', null, '<object>'],
    ['undefined', undefined, '<undefined>'],
    ['a boolean', true, '<boolean>'],
  ])('reduces %s to its type', (_label, value, expected) => {
    expect(clientStringForLog(value)).toBe(expected);
  });
});

describe('clientNumberForLog', () => {
  it('keeps a finite number', () => {
    expect(clientNumberForLog(3)).toBe(3);
    expect(clientNumberForLog(0)).toBe(0);
    expect(clientNumberForLog(-1.5)).toBe(-1.5);
  });

  it.each([
    ['NaN', Number.NaN, '<number>'],
    ['Infinity', Number.POSITIVE_INFINITY, '<number>'],
    ['a string', 'x'.repeat(900_000), '<string>'],
    ['an object', { a: 1 }, '<object>'],
    ['undefined', undefined, '<undefined>'],
  ])('reduces %s to its type', (_label, value, expected) => {
    expect(clientNumberForLog(value)).toBe(expected);
  });
});
