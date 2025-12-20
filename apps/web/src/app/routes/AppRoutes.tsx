import * as React from 'react';
import { WorldScreen } from './WorldScreen';
import { LandingPage, PricingPage, TenantSignupPage } from '../../ui/public';
import { PrivacyPolicy } from '../../ui/legal/PrivacyPolicy';
import { TermsOfService } from '../../ui/legal/TermsOfService';
import { Impressum } from '../../ui/legal/Impressum';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';

type Route = 'landing' | 'pricing' | 'signup' | 'app' | 'privacy' | 'terms' | 'impressum' | 'verify';

/**
 * Simple hash-based routing for public pages and the main app.
 *
 * Routes:
 * - #/         or no hash -> landing page (if not authenticated)
 * - #/pricing  -> pricing page
 * - #/signup   -> tenant signup page
 * - #/app      -> main application (WorldScreen)
 *
 * The WorldScreen handles its own auth flow internally.
 */
export function AppRoutes() {
  const [route, setRoute] = React.useState<Route>('landing');
  const [selectedPlan, setSelectedPlan] = React.useState<string | undefined>();

  const [verifyToken, setVerifyToken] = React.useState<string | undefined>();

  // Parse initial route from hash
  React.useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) || '/';
      if (hash === '/pricing') {
        setRoute('pricing');
      } else if (hash.startsWith('/signup')) {
        const params = new URLSearchParams(hash.split('?')[1] || '');
        setSelectedPlan(params.get('plan') || undefined);
        setRoute('signup');
      } else if (hash === '/privacy') {
        setRoute('privacy');
      } else if (hash === '/terms') {
        setRoute('terms');
      } else if (hash === '/impressum' || hash === '/imprint') {
        setRoute('impressum');
      } else if (hash.startsWith('/verify')) {
        const params = new URLSearchParams(hash.split('?')[1] || '');
        setVerifyToken(params.get('token') || undefined);
        setRoute('verify');
      } else if (hash === '/app' || hash.startsWith('/app')) {
        setRoute('app');
      } else {
        // Default: check if we should show landing or app
        // If there's a tenant subdomain, go directly to app
        const hostname = window.location.hostname;
        const isSubdomain = hostname.split('.').length > 2 && !hostname.startsWith('www.');
        if (isSubdomain) {
          setRoute('app');
        } else {
          setRoute('landing');
        }
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = (newRoute: Route, params?: Record<string, string>) => {
    let hash = `#/${newRoute === 'landing' ? '' : newRoute}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      hash += `?${searchParams.toString()}`;
    }
    window.location.hash = hash;
    setRoute(newRoute);
  };

  const apiBase = getApiBaseFromWindow();

  switch (route) {
    case 'landing':
      return (
        <LandingPage
          onLogin={() => navigate('app')}
          onSignup={() => navigate('signup')}
          onPricing={() => navigate('pricing')}
        />
      );

    case 'pricing':
      return (
        <PricingPage
          onBack={() => navigate('landing')}
          onLogin={() => navigate('app')}
          onSignup={(plan) => {
            setSelectedPlan(plan);
            navigate('signup', plan ? { plan } : undefined);
          }}
        />
      );

    case 'signup':
      return (
        <TenantSignupPage
          apiBase={apiBase}
          onBack={() => navigate('landing')}
          selectedPlan={selectedPlan}
          onSuccess={(tenantSlug) => {
            // After signup, redirect to the tenant's subdomain or the app
            const currentHost = window.location.hostname;
            if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
              // In development, just go to the app
              navigate('app');
            } else {
              // In production, redirect to tenant subdomain
              const protocol = window.location.protocol;
              const baseDomain = currentHost.split('.').slice(-2).join('.');
              window.location.href = `${protocol}//${tenantSlug}.${baseDomain}`;
            }
          }}
        />
      );

    case 'privacy':
      return <PrivacyPolicy onBack={() => navigate('landing')} />;

    case 'terms':
      return <TermsOfService onBack={() => navigate('landing')} />;

    case 'impressum':
      return <Impressum onBack={() => navigate('landing')} />;

    case 'verify':
      return (
        <EmailVerifyPage
          token={verifyToken}
          apiBase={apiBase}
          onSuccess={() => navigate('app')}
          onBack={() => navigate('landing')}
        />
      );

    case 'app':
    default:
      return <WorldScreen />;
  }
}

// Simple email verification page
function EmailVerifyPage({
  token,
  apiBase,
  onSuccess,
  onBack,
}: {
  token?: string | undefined;
  apiBase: string;
  onSuccess: () => void;
  onBack: () => void;
}) {
  const [status, setStatus] = React.useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token provided');
      return;
    }

    const verify = async () => {
      try {
        const res = await fetch(`${apiBase}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token }),
        });

        if (res.ok) {
          setStatus('success');
          setMessage('Email verified successfully!');
          setTimeout(onSuccess, 2000);
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus('error');
          setMessage(data.error || 'Verification failed');
        }
      } catch (e: any) {
        setStatus('error');
        setMessage(e.message || 'Network error');
      }
    };

    verify();
  }, [token, apiBase, onSuccess]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg, #0a0a0a)',
      color: 'var(--fg, #fff)',
    }}>
      <div style={{
        textAlign: 'center',
        padding: 40,
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 16,
        maxWidth: 400,
      }}>
        {status === 'verifying' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>Loading...</div>
            <p>Verifying your email...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16, color: '#22c55e' }}>check_circle</div>
            <h2 style={{ marginBottom: 8 }}>Email Verified!</h2>
            <p style={{ color: 'var(--fg-subtle, #888)' }}>{message}</p>
            <p style={{ color: 'var(--fg-subtle, #888)', fontSize: 14 }}>Redirecting...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16, color: '#ef4444' }}>error</div>
            <h2 style={{ marginBottom: 8 }}>Verification Failed</h2>
            <p style={{ color: 'var(--fg-subtle, #888)', marginBottom: 24 }}>{message}</p>
            <button
              onClick={onBack}
              style={{
                padding: '10px 24px',
                background: 'var(--accent, #3b82f6)',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Go Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
