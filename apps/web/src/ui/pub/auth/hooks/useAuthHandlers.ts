import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthApi } from './useAuthApi';
import { getTelemetryModule } from '../../../../lib/telemetryLoader';

interface AuthTokenResponse {
  token?: string | null;
}

interface UseAuthHandlersArgs {
  apiBase: string;
  setError: (msg: string | null) => void;
  setMessage: (msg: string | null) => void;
  setMessageType: (t: 'error' | 'success') => void;
  setView: (view: AuthViewName) => void;
}

export type AuthViewName = 'login' | 'register' | 'invite' | 'forgot' | 'reset' | 'guest';

export interface AuthHandlers {
  handleLogin: (email: string, password: string) => Promise<void>;
  handleRegister: (
    data: { name: string; email: string; password: string; invite?: string | undefined },
    currentInvite: string,
  ) => Promise<void>;
  /** Resolves true when the reset mail request was accepted (always neutral about whether the address exists). */
  handleForgot: (email: string) => Promise<boolean>;
  handleReset: (email: string, token: string, password: string) => Promise<void>;
  storeDesktopAuthToken: (token: string) => Promise<void>;
  postRaw: ReturnType<typeof useAuthApi>['post'];
}

export function useAuthHandlers({
  apiBase,
  setError,
  setMessage,
  setMessageType,
  setView,
}: UseAuthHandlersArgs): AuthHandlers {
  const { t } = useTranslation('public');
  const { post, storeDesktopAuthToken } = useAuthApi(apiBase);

  const handleLogin = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        const result = (await post('/auth/login', { email, password })) as AuthTokenResponse;
        if (result.token) await storeDesktopAuthToken(result.token);
        // Explicit user login succeeded (guest/debug auto-login runs elsewhere and
        // is intentionally excluded). Fire the optional telemetry login event
        // before navigating away. Null-safe and fire-and-forget.
        void getTelemetryModule()
          .then((t) => t?.trackLogin())
          .catch(() => {});
        window.location.hash = '#/app';
      } catch (e: unknown) {
        setError((e as Error).message);
      }
    },
    [post, storeDesktopAuthToken, setError],
  );

  const handleRegister = useCallback(
    async (
      data: { name: string; email: string; password: string; invite?: string | undefined },
      currentInvite: string,
    ) => {
      setError(null);
      try {
        const result = (await post('/auth/register', {
          code: data.invite || currentInvite,
          name: data.name,
          email: data.email,
          password: data.password,
        })) as AuthTokenResponse;
        if (result.token) await storeDesktopAuthToken(result.token);
        // Invite-code registration succeeded — a user joining an EXISTING tenant,
        // as opposed to the tenant-creation signup in useTenantCreation.ts. That
        // path already fires trackSignup(); this one did not, so half of new
        // users never reached the funnel. Tagged 'invite' so the downstream
        // telemetry can tell the two signup shapes apart. Null-safe and
        // fire-and-forget, same pattern as the login event above.
        void getTelemetryModule()
          .then((t) => t?.trackSignup('invite'))
          .catch(() => {});
        window.location.hash = '#/app';
      } catch (e: unknown) {
        setError((e as Error).message);
      }
    },
    [post, storeDesktopAuthToken, setError],
  );

  const handleForgot = useCallback(
    async (email: string) => {
      setError(null);
      setMessage(null);
      try {
        await post('/auth/forgot', { email });
        // Deliberately no jump to the reset form: the token now arrives by mail
        // (POST /auth/forgot sends `/#/reset?token=…&email=…`), so the address
        // bar carries it when the user returns. Sending them to a form that
        // demands a token they do not have yet was the dead end. The caller
        // shows a "check your inbox" confirmation instead.
        //
        // The response is 200 and deliberately neutral whether or not the
        // address is known, so `true` means "request accepted", never "an
        // account exists" — the confirmation copy is worded accordingly.
        return true;
      } catch (e: unknown) {
        setMessage((e as Error).message);
        setMessageType('error');
        return false;
      }
    },
    [post, setError, setMessage, setMessageType],
  );

  const handleReset = useCallback(
    async (email: string, token: string, password: string) => {
      setError(null);
      setMessage(null);
      try {
        await post('/auth/reset', { email, token, password });
        setMessage(t('auth.resetSuccess'));
        setMessageType('success');
        setView('login');
      } catch (e: unknown) {
        setMessage((e as Error).message);
        setMessageType('error');
      }
    },
    [post, setError, setMessage, setMessageType, setView, t],
  );

  return { handleLogin, handleRegister, handleForgot, handleReset, storeDesktopAuthToken, postRaw: post };
}
