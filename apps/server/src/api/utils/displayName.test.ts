import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { displayNameSchema, invalidNameBody, invalidNameBodyFor, MAX_DISPLAY_NAME_LENGTH } from './displayName.js';

describe('displayNameSchema', () => {
  it.each(['Alice', 'Jörg Müller-Lüdenscheidt', 'Straße ß Ä Ö Ü', '日本語の名前', 'a'])(
    'accepts %s unchanged',
    (name) => {
      expect(displayNameSchema.parse(name)).toBe(name);
    },
  );

  it('drops the whitespace around a name', () => {
    expect(displayNameSchema.parse('  Jörg Müller \t\n')).toBe('Jörg Müller');
  });

  it('keeps the whitespace inside a name', () => {
    expect(displayNameSchema.parse('Anna  Maria')).toBe('Anna  Maria');
  });

  it('accepts exactly the limit, also when whitespace around it would push it over', () => {
    const atLimit = 'ä'.repeat(MAX_DISPLAY_NAME_LENGTH);
    expect(displayNameSchema.parse(atLimit)).toBe(atLimit);
    expect(displayNameSchema.parse(`   ${atLimit}   `)).toBe(atLimit);
  });

  it.each([
    ['one character over the limit', 'a'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)],
    ['900,000 characters', 'x'.repeat(900_000)],
    ['an empty string', ''],
    ['only whitespace', ' \t\n '],
    ['a number', 7],
    ['an object', { a: 1 }],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(displayNameSchema.safeParse(value).success).toBe(false);
  });

  it('limits the display name to the 200 characters of Npc.name', () => {
    expect(MAX_DISPLAY_NAME_LENGTH).toBe(200);
  });
});

describe('invalidNameBodyFor', () => {
  const schema = z.object({ email: z.string().email(), name: displayNameSchema.optional() });

  it('names the issues of a rejected name field', () => {
    const parsed = schema.safeParse({ email: 'a@example.test', name: 'x'.repeat(201) });
    if (parsed.success) throw new Error('expected the parse to fail');

    const body = invalidNameBodyFor(parsed.error);

    expect(body?.error).toBe('invalid name');
    expect(body?.details).toHaveLength(1);
    expect(body?.details[0]).toMatchObject({ code: 'too_big', maximum: MAX_DISPLAY_NAME_LENGTH, path: ['name'] });
    expect(JSON.stringify(body).length).toBeLessThan(1_000);
  });

  it('is null when the failure is about another field', () => {
    const parsed = schema.safeParse({ email: 'not-an-email', name: 'Alice' });
    if (parsed.success) throw new Error('expected the parse to fail');

    expect(invalidNameBodyFor(parsed.error)).toBeNull();
  });

  it('reports only the name issues when another field fails too', () => {
    const parsed = schema.safeParse({ email: 'not-an-email', name: '' });
    if (parsed.success) throw new Error('expected the parse to fail');

    expect(invalidNameBodyFor(parsed.error)?.details.map((issue) => issue.path[0])).toEqual(['name']);
  });
});

describe('invalidNameBody', () => {
  it('wraps issues in the usual error shape', () => {
    const parsed = displayNameSchema.safeParse('');
    if (parsed.success) throw new Error('expected the parse to fail');

    expect(invalidNameBody(parsed.error.issues)).toEqual({ error: 'invalid name', details: parsed.error.issues });
  });
});
