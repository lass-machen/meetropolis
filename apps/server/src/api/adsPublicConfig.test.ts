/**
 * Ads consent config for GET /public/config (OSS fallback).
 *
 * Pure env normalization: no database, no network. The cases below pin the
 * contract from the integration design: null when nothing is configured,
 * strict tag id and label validation, and `banner` for every consent value
 * except the exact string 'bypass'.
 */
import { describe, expect, it } from 'vitest';
import { getAdsPublicConfig } from './adsPublicConfig.js';

describe('getAdsPublicConfig', () => {
  it('returns null when neither the tag id nor the consent mode is set', () => {
    expect(getAdsPublicConfig({})).toBeNull();
  });

  it('returns null for empty values', () => {
    expect(getAdsPublicConfig({ PUBLIC_GOOGLE_ADS_ID: '', PUBLIC_ADS_CONSENT_MODE: '' })).toBeNull();
  });

  it('keeps bypass mode even without a tag id', () => {
    expect(getAdsPublicConfig({ PUBLIC_ADS_CONSENT_MODE: 'bypass' })).toEqual({
      googleAdsId: null,
      signupConversionLabel: null,
      consentMode: 'bypass',
    });
  });

  it('adopts a valid tag id and conversion label', () => {
    expect(
      getAdsPublicConfig({
        PUBLIC_GOOGLE_ADS_ID: 'AW-123456789',
        PUBLIC_GOOGLE_ADS_SIGNUP_LABEL: 'abcDEF_12-34',
      }),
    ).toEqual({
      googleAdsId: 'AW-123456789',
      signupConversionLabel: 'abcDEF_12-34',
      consentMode: 'banner',
    });
  });

  it.each(['G-ABC', 'AW-12', 'AW-1234567890123456', ' AW-123456 '])(
    'nulls the tag id for %s but keeps the block',
    (id) => {
      const config = getAdsPublicConfig({ PUBLIC_GOOGLE_ADS_ID: id });
      expect(config).not.toBeNull();
      expect(config?.googleAdsId).toBeNull();
    },
  );

  it('nulls an invalid conversion label', () => {
    const config = getAdsPublicConfig({
      PUBLIC_GOOGLE_ADS_ID: 'AW-123456789',
      PUBLIC_GOOGLE_ADS_SIGNUP_LABEL: 'has space!',
    });
    expect(config?.signupConversionLabel).toBeNull();
  });

  it.each(['BYPASS', 'foo', ''])('falls back to banner mode for %s', (mode) => {
    const config = getAdsPublicConfig({
      PUBLIC_GOOGLE_ADS_ID: 'AW-123456789',
      PUBLIC_ADS_CONSENT_MODE: mode,
    });
    expect(config?.consentMode).toBe('banner');
  });
});
