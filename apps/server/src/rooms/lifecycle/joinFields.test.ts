import { describe, expect, it } from 'vitest';
import { clampJoinText, MAX_JOIN_TEXT_LENGTH } from './joinFields.js';

describe('clampJoinText', () => {
  it.each(['Alice', 'Jörg Müller-Lüdenscheidt', 'Straße ß Ä Ö Ü', '日本語の名前', 'a b', ''])(
    'keeps %j unchanged',
    (name) => {
      expect(clampJoinText(name)).toBe(name);
    },
  );

  it('keeps a text of exactly the limit unchanged', () => {
    const atLimit = 'ö'.repeat(MAX_JOIN_TEXT_LENGTH);
    expect(clampJoinText(atLimit)).toBe(atLimit);
  });

  it('cuts a text one above the limit to the limit', () => {
    expect(clampJoinText('a'.repeat(MAX_JOIN_TEXT_LENGTH + 1))).toBe('a'.repeat(MAX_JOIN_TEXT_LENGTH));
  });

  it('cuts a 900,000 character text to the limit', () => {
    expect(clampJoinText('x'.repeat(900_000))).toHaveLength(MAX_JOIN_TEXT_LENGTH);
  });

  it('never leaves half of a surrogate pair at the cut', () => {
    // The emoji is two UTF-16 units, so a cut at the limit would split it.
    const text = `${'a'.repeat(MAX_JOIN_TEXT_LENGTH - 1)}\u{1F600}tail`;
    const clamped = clampJoinText(text);
    expect(clamped).toBe('a'.repeat(MAX_JOIN_TEXT_LENGTH - 1));
    expect(Buffer.from(clamped, 'utf8').toString('utf8')).toBe(clamped);
  });

  it('keeps a whole surrogate pair that ends exactly at the limit', () => {
    const text = `${'a'.repeat(MAX_JOIN_TEXT_LENGTH - 2)}\u{1F600}tail`;
    expect(clampJoinText(text)).toBe(`${'a'.repeat(MAX_JOIN_TEXT_LENGTH - 2)}\u{1F600}`);
  });

  it.each([[undefined], [null], [7], [true], [{ a: 1 }], [['a']]])(
    'turns %j, which is no string, into an empty text',
    (value) => {
      expect(clampJoinText(value)).toBe('');
    },
  );
});
