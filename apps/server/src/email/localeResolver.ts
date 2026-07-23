/**
 * Locale resolution for OSS mail delivery.
 *
 * 4-stage chain (PE specification for Block C; the fifth stage
 * `tenant.locale` is not present in the OSS schema and is therefore
 * skipped):
 *
 *   1. `params.locale` — explicit caller param
 *   2. `userLocale`     — provided by the caller via DB lookup
 *   3. `MAIL_DEFAULT_LOCALE` — ENV default
 *   4. `'de'` — last-resort default
 */

import type { EmailLocale } from './types.js';

function normalize(candidate: unknown): EmailLocale | null {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim().toLowerCase();
  if (trimmed === 'de' || trimmed.startsWith('de-')) return 'de';
  if (trimmed === 'en' || trimmed.startsWith('en-')) return 'en';
  return null;
}

export interface LocaleResolutionInput {
  // `paramsLocale` is typed permissively (`string`) because callers
  // frequently funnel ENV / DB-string values through this resolver
  // without first narrowing to the `EmailLocale` literal union.
  paramsLocale?: string | null;
  userLocale?: string | null;
}

/**
 * Returns the effective locale for mail delivery. Pure function with no
 * side effects; the ENV read happens once inside `readEnvDefaultLocale()`.
 */
export function resolveLocale(input: LocaleResolutionInput, envDefault: EmailLocale): EmailLocale {
  const fromParam = normalize(input.paramsLocale);
  if (fromParam) return fromParam;
  const fromUser = normalize(input.userLocale);
  if (fromUser) return fromUser;
  return envDefault;
}

/**
 * Reads `MAIL_DEFAULT_LOCALE` from the environment and falls back to
 * `'de'` if not set or invalid. Callers typically cache this value
 * at provider boot time.
 */
export function readEnvDefaultLocale(): EmailLocale {
  return normalize(process.env.MAIL_DEFAULT_LOCALE) ?? 'de';
}
