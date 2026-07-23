import i18n from '../app/providers/i18n';

/**
 * Translates an API error code to a localized message.
 * Falls back to the raw error string if no translation is found.
 */
export function translateApiError(errorCode: string | undefined | null): string {
  if (!errorCode) return '';
  const key = `apiError.${errorCode.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const translated = i18n.t(key);
  // If i18next returns the key itself, no translation exists -- fall back
  return translated === key ? errorCode : translated;
}
