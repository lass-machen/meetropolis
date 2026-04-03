import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '../layout/AuthLayout';
import { useAuthApi } from './hooks/useAuthApi';
import { LoginView } from './LoginView';
import { RegisterView } from './RegisterView';
import { RegisterStep2View } from './RegisterStep2View';
import { RegisterStep3View } from './RegisterStep3View';
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
  registrationEnabled?: boolean;
}

/* ---------- Component ---------- */

export function AuthPage({
  apiBase,
  initialView = 'login',
  initialInvite,
  initialResetToken,
  initialResetEmail,
  initialGuestToken,
  registrationEnabled = true,
}: AuthPageProps) {
  const { t } = useTranslation('public');
  const { post, storeDesktopAuthToken } = useAuthApi(apiBase);

  const [view, setView] = useState<AuthView>(initialView);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'error' | 'success'>('error');
  const [invite, setInvite] = useState(initialInvite || '');
  const [guestLoading, setGuestLoading] = useState(false);

  /* ---------- Registration wizard state ---------- */
  const [regStep, setRegStep] = useState(1);
  const [regData, setRegData] = useState<{
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    teamName: string;
    teamSize: string;
    slug: string;
    plan: string;
  }>({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    teamName: '',
    teamSize: '1-10',
    slug: '',
    plan: 'team',
  });
  const [slugError, setSlugError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  /* ---------- Redirect when registration disabled ---------- */
  useEffect(() => {
    if (!registrationEnabled && view === 'register' && !invite && !initialInvite) {
      setView('login');
    }
  }, [registrationEnabled, view, invite, initialInvite]);

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

  /* ---------- Tenant creation (3-step wizard) ---------- */

  async function handleCreateTenant(plan: string) {
    setSlugError(null);
    setError(null);
    setSubmitLoading(true);
    try {
      const res = await fetch(`${apiBase}/public/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          slug: regData.slug,
          name: regData.teamName,
          email: regData.email,
          password: regData.password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'slug_exists') {
          setSlugError(t('auth.slugExists'));
          setRegStep(2);
          return;
        }
        throw new Error(data.error || t('common.error'));
      }
      // Store token for Desktop clients
      if (data.token) {
        await storeDesktopAuthToken(data.token);
      }
      // Redirect to tenant subdomain (same logic as old TenantSignupPage)
      const currentHost = window.location.hostname;
      if ((window as unknown as Record<string, string>).__MEETROPOLIS_API_BASE__) {
        window.location.hash = '#/app';
      } else if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
        window.location.hash = '#/app';
      } else {
        const protocol = window.location.protocol;
        const baseDomain = currentHost.split('.').slice(-2).join('.');
        window.location.href = `${protocol}//${regData.slug}.${baseDomain}`;
      }
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSubmitLoading(false);
      // Save chosen plan in state for potential future use
      setRegData((prev) => ({ ...prev, plan }));
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
            onInvite={() => switchView('invite')}
            error={error}
            successMessage={messageType === 'success' ? message : null}
            registrationEnabled={registrationEnabled}
          />
        );

      case 'register':
        // Invite-based registration (existing team member joining)
        if (invite) {
          return (
            <RegisterView
              onSubmit={handleRegister}
              onLogin={() => switchView('login')}
              initialInvite={invite}
              error={error}
            />
          );
        }
        // 3-Step Wizard (new tenant creation)
        if (regStep === 1) {
          return (
            <RegisterView
              onSubmit={async (data) => {
                const nameParts = data.name.split(' ');
                setRegData((prev) => ({
                  ...prev,
                  firstName: nameParts[0] || '',
                  lastName: nameParts.slice(1).join(' ') || '',
                  email: data.email,
                  password: data.password,
                }));
                setRegStep(2);
              }}
              onLogin={() => switchView('login')}
              error={error}
            />
          );
        }
        if (regStep === 2) {
          return (
            <RegisterStep2View
              onNext={(data) => {
                setRegData((prev) => ({ ...prev, ...data }));
                setSlugError(null);
                setRegStep(3);
              }}
              onBack={() => setRegStep(1)}
              initialData={{
                teamName: regData.teamName,
                teamSize: regData.teamSize,
                slug: regData.slug,
              }}
              slugError={slugError}
            />
          );
        }
        if (regStep === 3) {
          return (
            <RegisterStep3View
              onSubmit={handleCreateTenant}
              onBack={() => setRegStep(2)}
              initialPlan={regData.plan}
              error={error}
              loading={submitLoading}
            />
          );
        }
        return null;

      case 'invite':
        return (
          <InviteCodeView
            onSubmit={handleInvite}
            onLogin={() => switchView('login')}
            onRegister={() => switchView('register')}
            initialCode={initialInvite}
            error={error}
            registrationEnabled={registrationEnabled}
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
