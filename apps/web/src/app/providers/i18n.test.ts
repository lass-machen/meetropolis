import { describe, it, expect } from 'vitest';
import i18n from './i18n';

describe('i18n basic translation', () => {
  it('returns English by default/fallback', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('modal.close')).toBe('Close');
  });

  it('returns German when language is de', async () => {
    await i18n.changeLanguage('de');
    expect(i18n.t('modal.close')).toBe('Schließen');
  });
});


