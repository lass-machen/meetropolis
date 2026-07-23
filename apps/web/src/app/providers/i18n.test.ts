import { describe, it, expect, beforeAll } from 'vitest';
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

describe('i18n OSS billing + OSS-hero defaults (public namespace)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('resolves billing.successTitle to a translated string, not the raw key', () => {
    expect(i18n.t('billing.successTitle', { ns: 'public' })).not.toBe('billing.successTitle');
    expect(i18n.t('billing.successTitle', { ns: 'public' })).toMatch(/payment/i);
  });

  // Copy shown when the reconcile reports a TRIALING subscription. It promises
  // that nothing has been charged, so it must never be reachable for any other
  // state — the component decides that (see settledCopyKeyFor); here we only
  // pin the wording it may not silently acquire.
  it('resolves billing.trialStartedTitle/-Text without claiming a payment happened', () => {
    const title = i18n.t('billing.trialStartedTitle', { ns: 'public' });
    const text = i18n.t('billing.trialStartedText', { ns: 'public' });
    expect(title).not.toBe('billing.trialStartedTitle');
    expect(text).not.toBe('billing.trialStartedText');
    expect(title).toMatch(/trial/i);
    expect(text).not.toMatch(/payment (has been|was) (processed|successful)/i);
  });

  // Fallback copy for a settled reconcile whose subscription is neither
  // trialing nor active (past_due, or no status reported). It must claim
  // NEITHER a trial NOR a payment.
  it('resolves billing.subscriptionReadyTitle/-Text without any money claim', () => {
    const title = i18n.t('billing.subscriptionReadyTitle', { ns: 'public' });
    const text = i18n.t('billing.subscriptionReadyText', { ns: 'public' });
    expect(title).not.toBe('billing.subscriptionReadyTitle');
    expect(text).not.toBe('billing.subscriptionReadyText');
    expect(text).not.toMatch(/nothing has been charged/i);
    expect(text).not.toMatch(/payment (has been|was) (processed|successful)/i);
  });

  it('resolves billing.cancelTitle to a translated string, not the raw key', () => {
    expect(i18n.t('billing.cancelTitle', { ns: 'public' })).not.toBe('billing.cancelTitle');
  });

  it('resolves header.ossHeroTitle without inline default', () => {
    expect(i18n.t('header.ossHeroTitle', { ns: 'public' })).not.toBe('header.ossHeroTitle');
    expect(i18n.t('header.ossHeroTitle', { ns: 'public' })).toMatch(/Self-Hosted/i);
  });

  it('interpolates {{year}} and {{brandName}} into footer.copyright', () => {
    const result = i18n.t('footer.copyright', { ns: 'public', year: 2030, brandName: 'TestBrand' });
    expect(result).toContain('2030');
    expect(result).toContain('TestBrand');
  });
});

describe('i18n sentinel override keys (raw === key contract)', () => {
  // OSS-Build liefert fuer diese Keys keinen Wert; Komponenten erkennen das
  // an `raw === key` und unterdruecken den Render (kein <img> ohne src,
  // kein Marketing-Hero ohne Brand). Wuerde i18next hier irgendetwas
  // anderes zurueckgeben, wuerde die Sentinel-Logik brechen — daher
  // schuetzen wir den Vertrag explizit ueber Tests.
  const SENTINEL_KEYS = [
    'auth.heroImageSrc',
    'auth.heroImageAlt',
    'features.feature1Image',
    'features.feature2Image',
    'features.feature3Image',
    'features.feature4Image',
  ] as const;

  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  for (const key of SENTINEL_KEYS) {
    it(`returns the raw key for the OSS sentinel "${key}"`, () => {
      expect(i18n.t(key, { ns: 'public' })).toBe(key);
    });
  }
});
