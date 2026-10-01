import { describe, expect, it } from 'vitest';
import { profilePatchBody } from './profilePatchBody';

describe('profilePatchBody', () => {
  it('sends the name and the e-mail address when there is a name', () => {
    expect(profilePatchBody('Jörg Müller', 'joerg@example.test')).toEqual({
      name: 'Jörg Müller',
      email: 'joerg@example.test',
    });
  });

  it('sends the name trimmed', () => {
    expect(profilePatchBody('  Jörg Müller \t', 'joerg@example.test')).toEqual({
      name: 'Jörg Müller',
      email: 'joerg@example.test',
    });
  });

  it.each([
    ['an empty name', ''],
    ['a blank name', ' \t  '],
  ])('sends only the e-mail address for %s, so an account without a name can still change it', (_label, name) => {
    const body = profilePatchBody(name, 'joerg@example.test');

    expect(body).toEqual({ email: 'joerg@example.test' });
    expect(body).not.toHaveProperty('name');
    expect(JSON.stringify(body)).toBe('{"email":"joerg@example.test"}');
  });
});
