import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '../layout/AuthLayout';
import { useAuthApi } from './hooks/useAuthApi';
import { LoginView } from './LoginView';
import { RegisterView } from './RegisterView';
import { InviteCodeView } from './InviteCodeView';
import { ForgotPasswordView } from './ForgotPasswordView';
import { ResetPasswordView } from './ResetPasswordView';
import { GuestView } from './GuestView';

/* ---------- Types ---------- */

type AuthView = 'login' | 'register' | 'invite' | 'forgot' | 'reset' | 'guest';

interface AuthPageProps {
  apiBase: string;
  initialView?: AuthView;
  initialInvite?: string | undefined;
  initialResetToken?: string | undefined;
  initialResetEmail?: string | undefined;
  initialGuestToken?: string | undefined;
}

/* ---------- Component ---------- */

export function AuthPage({
  apiBase,
  initialView = 'login',
  initialInvite,
  initialResetToken,
  initialResetEmail,
  initialGuestToken,
}: AuthPageProps) {
  const { t } = useTranslation('public');
  const { post, storeDesktopAuthToken } = useAuthApi(apiBase);

  const [view, setView] = useState<AuthView>(initialView);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'error' | 'success'>('error');
  const [invite, setInvite] = useState(initialInvite || '');
  const [guestLoading, setGuestLoading] = useState(false);

  /* ---------- Debug Auto-Login ---------- */
  useEffect(() => {
    try {
      const env: Record<string, string> = (import.meta as unknown as { env: Record<string, string> }).env || {};
      const enabled =
        String(env.VITE_DEBUG_AUTOLOGIN || '').toLowerCase() === 'true';
      const isProd = Boolean(
        (import.meta as unknown as { env: { PROD?: boolean } }).env?.PROD,
      );
      if (!enabled) return;

      // Only allow on localhost
      const host = window.location.hostname;
      if (host !== 'localhost' && host !== '127.0.0.1') return;

      // Safety: in PROD only if explicitly allowed
      if (
        isProd &&
        String(env.VITE_DEBUG_AUTOLOGIN_ALLOW_PROD || '').toLowerCase() !== 'true'
      ) {
        return;
      }

      const autoEmail = env.VITE_DEBUG_AUTOLOGIN_EMAIL || 'admin@meetropolis.local';
      const autoPassword = env.VITE_DEBUG_AUTOLOGIN_PASSWORD || 'admin123';

      (async () => {
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

  /* ---------- Guest auto-login ---------- */
  useEffect(() => {
    if (!initialGuestToken || view !== 'guest') return;
    setGuestLoading(true);

    (async () => {
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

  /* ---------- Handlers ---------- */

  async function handleLogin(email: string, password: string) {
    setError(null);
    try {
      const result = await post('/auth/login', { email, password });
      if (result.token) await storeDesktopAuthToken(result.token);
      window.location.hash = '#/app';
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  async function handleRegister(data: {
    name: string;
    email: string;
    password: string;
    invite?: string | undefined;
  }) {
    setError(null);
    try {
      const result = await post('/auth/register', {
        code: data.invite || invite,
        name: data.name,
        email: data.email,
        password: data.password,
      });
      if (result.token) await storeDesktopAuthToken(result.token);
      window.location.hash = '#/app';
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  async function handleInvite(code: string) {
    setError(null);
    // Save invite code and navigate to register
    setInvite(code);
    setView('register');
  }

  async function handleForgot(email: string) {
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
  }

  async function handleReset(
    email: string,
    token: string,
    password: string,
  ) {
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
  }

  /* ---------- View switching helpers ---------- */

  function switchView(next: AuthView) {
    setError(null);
    setMessage(null);
    setView(next);
  }

  /* ---------- Render active view ---------- */

  function renderView() {
    switch (view) {
      case 'login':
        return (
          <LoginView
            onSubmit={handleLogin}
            onForgot={() => switchView('forgot')}
            onRegister={() => switchView('register')}
            error={error}
            successMessage={messageType === 'success' ? message : null}
          />
        );

      case 'register':
        return (
          <RegisterView
            onSubmit={handleRegister}
            onLogin={() => switchView('login')}
            initialInvite={invite}
            error={error}
          />
        );

      case 'invite':
        return (
          <InviteCodeView
            onSubmit={handleInvite}
            onLogin={() => switchView('login')}
            onRegister={() => switchView('register')}
            initialCode={initialInvite}
            error={error}
          />
        );

      case 'forgot':
        return (
          <ForgotPasswordView
            onSubmit={handleForgot}
            onBack={() => switchView('login')}
            message={message}
            messageType={messageType}
          />
        );

      case 'reset':
        return (
          <ResetPasswordView
            onSubmit={handleReset}
            onBack={() => switchView('login')}
            initialEmail={initialResetEmail}
            initialToken={initialResetToken}
            message={message}
            messageType={messageType}
          />
        );

      case 'guest':
        return (
          <GuestView
            loading={guestLoading}
            error={error}
            onBack={() => switchView('login')}
          />
        );

      default:
        return null;
    }
  }

  return <AuthLayout>{renderView()}</AuthLayout>;
}
