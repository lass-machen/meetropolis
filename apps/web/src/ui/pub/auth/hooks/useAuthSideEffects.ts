import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthViewName, AuthHandlers } from './useAuthHandlers';

interface DebugAutoLoginArgs {
  post: AuthHandlers['postRaw'];
  storeDesktopAuthToken: AuthHandlers['storeDesktopAuthToken'];
  setError: (msg: string | null) => void;
}

export function useDebugAutoLogin({ post, storeDesktopAuthToken, setError }: DebugAutoLoginArgs) {
  const { t } = useTranslation('public');
  useEffect(() => {
    try {
      const env: Record<string, string> = (import.meta as unknown as { env: Record<string, string> }).env || {};
      const enabled = String(env.VITE_DEBUG_AUTOLOGIN || '').toLowerCase() === 'true';
      const isProd = Boolean((import.meta as unknown as { env: { PROD?: boolean } }).env?.PROD);
      if (!enabled) return;

      const host = window.location.hostname;
      if (host !== 'localhost' && host !== '127.0.0.1') return;

      if (isProd && String(env.VITE_DEBUG_AUTOLOGIN_ALLOW_PROD || '').toLowerCase() !== 'true') {
        return;
      }

      const autoEmail = env.VITE_DEBUG_AUTOLOGIN_EMAIL || 'admin@meetropolis.local';
      const autoPassword = env.VITE_DEBUG_AUTOLOGIN_PASSWORD || 'admin123';

      void (async () => {
        try {
          const result = await post('/auth/login', {
            email: autoEmail,
            password: autoPassword,
          });
          if (result.token) await storeDesktopAuthToken(result.token);
          window.location.hash = '#/app';
        } catch (e: unknown) {
          setError((e as Error)?.message || t('auth.loginTitle'));
        }
      })();
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

interface GuestAutoLoginArgs {
  initialGuestToken: string | undefined;
  view: AuthViewName;
  post: AuthHandlers['postRaw'];
  storeDesktopAuthToken: AuthHandlers['storeDesktopAuthToken'];
  setError: (msg: string | null) => void;
  setGuestLoading: (loading: boolean) => void;
}

export function useGuestAutoLogin({
  initialGuestToken,
  view,
  post,
  storeDesktopAuthToken,
  setError,
  setGuestLoading,
}: GuestAutoLoginArgs) {
  const { t } = useTranslation('public');
  useEffect(() => {
    if (!initialGuestToken || view !== 'guest') return;
    setGuestLoading(true);

    void (async () => {
      try {
        const result = await post('/auth/guest', { token: initialGuestToken });
        if (result.token) await storeDesktopAuthToken(result.token);
        window.location.hash = '#/app';
      } catch (e: unknown) {
        setGuestLoading(false);
        const msg = (e as Error)?.message || '';
        if (msg === 'guest_expired') {
          setError(t('auth.guestExpired'));
        } else if (msg === 'invalid_token') {
          setError(t('auth.guestInvalid'));
        } else {
          setError(msg || t('auth.guestFailed'));
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGuestToken]);
}

interface RedirectWhenRegistrationDisabledArgs {
  registrationEnabled: boolean;
  view: AuthViewName;
  invite: string;
  initialInvite: string | undefined;
  setView: (v: AuthViewName) => void;
}

export function useRedirectWhenRegistrationDisabled({
  registrationEnabled,
  view,
  invite,
  initialInvite,
  setView,
}: RedirectWhenRegistrationDisabledArgs) {
  useEffect(() => {
    if (!registrationEnabled && view === 'register' && !invite && !initialInvite) {
      setView('login');
    }
  }, [registrationEnabled, view, invite, initialInvite, setView]);
}
