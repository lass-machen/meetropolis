import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '../../locales/en/common.json';
import de from '../../locales/de/common.json';
import enPublic from '../../locales/en/public.json';
import dePublic from '../../locales/de/public.json';
import { getBrandModule } from '../../lib/brandLoader';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en, public: enPublic },
      de: { common: de, public: dePublic },
    },
    supportedLngs: ['en', 'de'],
    fallbackLng: 'en',
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'], lookupLocalStorage: 'i18nextLng' },
  })
  .catch(() => {
    // Initialization failures should not break the app; fall back silently.
  });

/**
 * When the brand submodule is installed, this loader pulls the marketing
 * bundles (de/en) and merges them into i18next:
 *  - `marketing.publicOverrides.<section>.<key>` is merged into the `public`
 *    namespace and overrides OSS defaults like `header.brandName` or
 *    `features.featureXImage`.
 *  - All other marketing top-level keys (e.g. `hero`, `pricing`, `consent`)
 *    are merged into the `public` namespace so brand sections can find their
 *    marketing strings.
 *
 * In OSS builds (no brand), only the OSS locales remain. Brand-specific keys
 * then return their own key string, which the components interpret as
 * "missing/empty" (see FeatureShowcaseSection.tsx, AuthLayout.tsx,
 * PublicHeader.tsx, PublicFooter.tsx).
 */
async function loadBrandOverrides() {
  try {
    const mod = await getBrandModule();
    if (!mod) return;
    const bundles: { lng: 'de' | 'en'; data: Record<string, unknown> }[] = [
      { lng: 'de', data: mod.marketingDe },
      { lng: 'en', data: mod.marketingEn },
    ];
    for (const { lng, data } of bundles) {
      const overrides = (data as { publicOverrides?: Record<string, unknown> }).publicOverrides;
      if (overrides) {
        i18n.addResourceBundle(lng, 'public', overrides, true, true);
      }
      // Nicht-override Marketing-Keys (hero, pricing, consent, social, …)
      const merged: Record<string, unknown> = { ...data };
      delete merged.publicOverrides;
      delete merged.commonLanding;
      i18n.addResourceBundle(lng, 'public', merged, true, true);
      const commonLanding = (data as { commonLanding?: Record<string, unknown> }).commonLanding;
      if (commonLanding) {
        i18n.addResourceBundle(lng, 'common', commonLanding, true, true);
      }
    }
  } catch {
    // OSS build: loader returns null, no brand bundle is available.
  }
}

void loadBrandOverrides();

export default i18n;

try {
  if (typeof window !== 'undefined') {
    window.i18next = i18n as unknown as Window['i18next'];
  }
} catch {}
