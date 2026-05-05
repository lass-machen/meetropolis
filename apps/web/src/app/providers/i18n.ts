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
      en: { common: en as Record<string, string>, public: enPublic },
      de: { common: de as Record<string, string>, public: dePublic }
    },
    supportedLngs: ['en', 'de'],
    fallbackLng: 'en',
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'], lookupLocalStorage: 'i18nextLng' }
  })
  .catch(() => {
    // Initialization failures should not break the app; fall back silently.
  });

/**
 * Wenn das Brand-Submodule installiert ist, lädt der Loader die marketing-
 * Bundles (de/en) und mergt sie ins i18next:
 *  - `marketing.publicOverrides.<section>.<key>` → public-namespace (überschreibt
 *    die OSS-Defaults wie `header.brandName`, `features.featureXImage`).
 *  - Alle anderen marketing-Top-Level-Keys (z.B. `hero`, `pricing`, `consent`)
 *    werden in den public-Namespace gemerged, damit Brand-Sections die
 *    Marketing-Strings finden.
 *
 * Im OSS-Build (kein Brand) bleibt es bei den OSS-Locales; Brand-spezifische
 * Keys liefern dann den Key-String selbst zurück, was die Komponenten als
 * "leer/abwesend" interpretieren (siehe FeatureShowcaseSection.tsx,
 * AuthLayout.tsx, PublicHeader.tsx, PublicFooter.tsx).
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
      delete (merged as Record<string, unknown>).publicOverrides;
      delete (merged as Record<string, unknown>).commonLanding;
      i18n.addResourceBundle(lng, 'public', merged, true, true);
      const commonLanding = (data as { commonLanding?: Record<string, unknown> }).commonLanding;
      if (commonLanding) {
        i18n.addResourceBundle(lng, 'common', commonLanding, true, true);
      }
    }
  } catch {
    // OSS-Build: Loader liefert null, kein Brand-Bundle vorhanden.
  }
}

void loadBrandOverrides();

export default i18n;

try {
  if (typeof window !== 'undefined') {
    (window as any).i18next = i18n;
  }
} catch {}
