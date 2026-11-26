/**
 * Ads consent block for GET /public/config (OSS fallback).
 *
 * Reads only public runtime values (PUBLIC_* env convention); no secrets.
 * Returns null when neither the tag id nor the consent mode is configured,
 * in which case the caller omits the `ads` block from the response so plain
 * OSS deployments leak no tracking hint.
 */

export type AdsConsentMode = 'banner' | 'bypass';

export interface PublicAdsConfig {
  /** Google tag id (e.g. "AW-123456789"); null disables the tag entirely. */
  googleAdsId: string | null;
  /** Conversion label for sign-up; null disables the conversion event. */
  signupConversionLabel: string | null;
  /** Unknown or missing values fall back to 'banner'. */
  consentMode: AdsConsentMode;
}

const TAG_ID_PATTERN = /^AW-\d{6,15}$/;
const CONVERSION_LABEL_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === '' ? undefined : value;
}

export function getAdsPublicConfig(env: NodeJS.ProcessEnv = process.env): PublicAdsConfig | null {
  const tagId = readEnv(env, 'PUBLIC_GOOGLE_ADS_ID');
  const consentMode = readEnv(env, 'PUBLIC_ADS_CONSENT_MODE');
  if (tagId === undefined && consentMode === undefined) return null;
  const label = readEnv(env, 'PUBLIC_GOOGLE_ADS_SIGNUP_LABEL');
  return {
    googleAdsId: tagId !== undefined && TAG_ID_PATTERN.test(tagId) ? tagId : null,
    signupConversionLabel: label !== undefined && CONVERSION_LABEL_PATTERN.test(label) ? label : null,
    consentMode: consentMode === 'bypass' ? 'bypass' : 'banner',
  };
}
