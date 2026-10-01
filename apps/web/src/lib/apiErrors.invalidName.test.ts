import { afterEach, describe, expect, it } from 'vitest';
import { MAX_DISPLAY_NAME_LENGTH } from '@meetropolis/shared';
import i18n from '../app/providers/i18n';
import { translateApiError } from './apiErrors';

// The real i18n instance on purpose: this is about the shipped locale files. A
// missing key would show the raw code of the server ("invalid name").
describe('translateApiError for a rejected display name', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each([
    ['en', `Invalid name: it must be 1 to ${MAX_DISPLAY_NAME_LENGTH} characters long`],
    ['de', `Ungültiger Name: Er muss 1 bis ${MAX_DISPLAY_NAME_LENGTH} Zeichen lang sein`],
  ])('shows the hint with the limit of the server in %s instead of the raw code', async (language, expected) => {
    await i18n.changeLanguage(language);

    expect(translateApiError('invalid name')).toBe(expected);
  });
});
