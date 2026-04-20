/**
 * Marketing-consent storage helper for the public website.
 *
 * Stores a single opt-in/opt-out decision in `localStorage` under the key
 * `meetropolis.consent.marketing`. Components can subscribe via `onChange`
 * to re-render (or re-open the banner) when the value changes — either from
 * another tab (native `storage` event) or from within the same tab (custom
 * `meetropolis:consent-changed` event that `set()` / `clear()` dispatch).
 */

export const MARKETING_CONSENT_KEY = 'meetropolis.consent.marketing';
export const CONSENT_CHANGED_EVENT = 'meetropolis:consent-changed';

export type MarketingConsent = 'granted' | 'denied' | 'unset';

function readFromStorage(): MarketingConsent {
  try {
    const raw = window.localStorage.getItem(MARKETING_CONSENT_KEY);
    if (raw === 'granted' || raw === 'denied') return raw;
    return 'unset';
  } catch {
    return 'unset';
  }
}

export function getMarketingConsent(): MarketingConsent {
  if (typeof window === 'undefined') return 'unset';
  return readFromStorage();
}

function dispatchChange(value: MarketingConsent): void {
  try {
    window.dispatchEvent(
      new CustomEvent<MarketingConsent>(CONSENT_CHANGED_EVENT, { detail: value }),
    );
  } catch {
    // ignore: dispatching is a best-effort UX signal.
  }
}

export function setMarketingConsent(value: 'granted' | 'denied'): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MARKETING_CONSENT_KEY, value);
  } catch {
    // ignore (e.g. private-mode Safari); banner stays open until reload.
  }
  dispatchChange(value);
}

export function clearMarketingConsent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(MARKETING_CONSENT_KEY);
  } catch {
    // ignore
  }
  dispatchChange('unset');
}

type Listener = (value: MarketingConsent) => void;

/**
 * Subscribes to consent changes from both same-tab mutations and other tabs.
 * Returns an unsubscribe function.
 */
export function onMarketingConsentChange(listener: Listener): () => void {
  if (typeof window === 'undefined') return () => {};

  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent<MarketingConsent>).detail;
    listener(detail ?? readFromStorage());
  };

  const onStorage = (e: StorageEvent) => {
    if (e.key !== MARKETING_CONSENT_KEY) return;
    listener(readFromStorage());
  };

  window.addEventListener(CONSENT_CHANGED_EVENT, onCustom as EventListener);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(CONSENT_CHANGED_EVENT, onCustom as EventListener);
    window.removeEventListener('storage', onStorage);
  };
}
