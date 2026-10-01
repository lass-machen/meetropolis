import { describe, expect, it } from 'vitest';
import { MAX_DISPLAY_NAME_LENGTH } from '@meetropolis/shared';
import { composeRegisterName, FIRST_NAME_MAX_LENGTH, LAST_NAME_MAX_LENGTH } from './registerName';

describe('register name limits', () => {
  it('add up with the joining space to the display name limit', () => {
    expect(FIRST_NAME_MAX_LENGTH + 1 + LAST_NAME_MAX_LENGTH).toBe(MAX_DISPLAY_NAME_LENGTH);
  });

  it('give both fields room for a long name', () => {
    expect(FIRST_NAME_MAX_LENGTH).toBe(100);
    expect(LAST_NAME_MAX_LENGTH).toBe(99);
  });

  it('keep the joined name within the limit when both fields are full', () => {
    const name = composeRegisterName('a'.repeat(FIRST_NAME_MAX_LENGTH), 'b'.repeat(LAST_NAME_MAX_LENGTH));

    expect(name.length).toBe(MAX_DISPLAY_NAME_LENGTH);
  });
});

describe('composeRegisterName', () => {
  it('joins first and last name with one space', () => {
    expect(composeRegisterName('Jörg', 'Müller-Lüdenscheidt')).toBe('Jörg Müller-Lüdenscheidt');
  });

  it('is the first name alone without a last name', () => {
    expect(composeRegisterName('Jörg', '')).toBe('Jörg');
  });

  it('drops the whitespace around both parts', () => {
    expect(composeRegisterName('  Jörg ', ' Müller  ')).toBe('Jörg Müller');
  });

  it.each([
    ['both parts empty', '', ''],
    ['both parts blank', '  ', '\t'],
  ])('is empty for %s', (_label, first, last) => {
    expect(composeRegisterName(first, last)).toBe('');
  });

  it('drops a blank first name instead of leaving a leading space', () => {
    expect(composeRegisterName('   ', 'Müller')).toBe('Müller');
  });
});
