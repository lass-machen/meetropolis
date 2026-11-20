import { expect, it } from 'vitest';
import { profilePatchBody } from './profilePatchBody';

it('saves the trimmed name without resubmitting the active email address as a change request', () => {
  expect(profilePatchBody('  Jorg Muller \t', 'joerg@example.test')).toEqual({ name: 'Jorg Muller' });
});

it.each(['', ' \t  '])('leaves a blank name and the email address unchanged', (name) => {
  expect(profilePatchBody(name, 'joerg@example.test')).toEqual({});
});
