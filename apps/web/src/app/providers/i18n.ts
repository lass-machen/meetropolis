import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '../../locales/en/common.json';
import de from '../../locales/de/common.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en as Record<string, string> },
      de: { common: de as Record<string, string> }
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

export default i18n;

try {
  if (typeof window !== 'undefined') {
    (window as any).i18next = i18n;
  }
} catch {}


