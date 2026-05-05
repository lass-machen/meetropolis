import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MARKETING_CONSENT_KEY,
  clearMarketingConsent,
  getMarketingConsent,
  onMarketingConsentChange,
  setMarketingConsent,
} from './marketingConsent';

describe('marketingConsent', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns "unset" when no decision is stored', () => {
    expect(getMarketingConsent()).toBe('unset');
  });

  it('persists and reads "granted"', () => {
    setMarketingConsent('granted');
    expect(window.localStorage.getItem(MARKETING_CONSENT_KEY)).toBe('granted');
    expect(getMarketingConsent()).toBe('granted');
  });

  it('persists and reads "denied"', () => {
    setMarketingConsent('denied');
    expect(getMarketingConsent()).toBe('denied');
  });

  it('clearMarketingConsent resets the stored value', () => {
    setMarketingConsent('granted');
    clearMarketingConsent();
    expect(getMarketingConsent()).toBe('unset');
  });

  it('ignores unexpected values and returns "unset"', () => {
    window.localStorage.setItem(MARKETING_CONSENT_KEY, 'maybe');
    expect(getMarketingConsent()).toBe('unset');
  });

  it('dispatches custom event on set and clear', () => {
    const listener = vi.fn();
    const unsubscribe = onMarketingConsentChange(listener);

    setMarketingConsent('granted');
    expect(listener).toHaveBeenCalledWith('granted');

    setMarketingConsent('denied');
    expect(listener).toHaveBeenCalledWith('denied');

    clearMarketingConsent();
    expect(listener).toHaveBeenCalledWith('unset');

    unsubscribe();
    setMarketingConsent('granted');
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
