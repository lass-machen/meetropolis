import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthApi } from './useAuthApi';

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
  handleRegister: (data: { name: string; email: string; password: string; invite?: string | undefined }, currentInvite: string) => Promise<void>;
  handleForgot: (email: string) => Promise<void>;
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

  const handleLogin = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const result = await post('/auth/login', { email, password });
      if (result.token) await storeDesktopAuthToken(result.token);
      window.location.hash = '#/app';
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, [post, storeDesktopAuthToken, setError]);

  const handleRegister = useCallback(async (
    data: { name: string; email: string; password: string; invite?: string | undefined },
    currentInvite: string,
  ) => {
    setError(null);
    try {
      const result = await post('/auth/register', {
        code: data.invite || currentInvite,
        name: data.name,
        email: data.email,
        password: data.password,
      });
      if (result.token) await storeDesktopAuthToken(result.token);
      window.location.hash = '#/app';
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, [post, storeDesktopAuthToken, setError]);

  const handleForgot = useCallback(async (email: string) => {
    setError(null);
    setMessage(null);
    try {
      await post('/auth/forgot', { email });
      setMessage(t('auth.forgotSuccess'));
      setMessageType('success');
      setView('reset');
    } catch (e: unknown) {
      setMessage((e as Error).message);
      setMessageType('error');
    }
  }, [post, setError, setMessage, setMessageType, setView, t]);

  const handleReset = useCallback(async (
    email: string,
    token: string,
    password: string,
  ) => {
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
  }, [post, setError, setMessage, setMessageType, setView, t]);

  return { handleLogin, handleRegister, handleForgot, handleReset, storeDesktopAuthToken, postRaw: post };
}
