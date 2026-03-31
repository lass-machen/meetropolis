import * as React from 'react';
import { WorldScreen } from './WorldScreen';
import { LandingPage } from '../../ui/pub/landing/LandingPage';

import { ImpressumPage } from '../../ui/pub/legal/ImpressumPage';
import { PrivacyPolicyPage } from '../../ui/pub/legal/PrivacyPolicyPage';
import { TermsOfServicePage } from '../../ui/pub/legal/TermsOfServicePage';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';
import { BillingSuccessPage } from '../../ui/pub/billing/BillingSuccessPage';
import { BillingCancelPage } from '../../ui/pub/billing/BillingCancelPage';
import { EmailVerifyPage } from '../../ui/pub/billing/EmailVerifyPage';
import { AuthPage } from '../../ui/pub/auth/AuthPage';

type Route = 'landing' | 'pricing' | 'app' | 'privacy' | 'terms' | 'impressum' | 'verify' | 'billing-success' | 'billing-cancel' | 'login' | 'register' | 'invite' | 'guest-auth' | 'reset-pw';

/**
 * Simple hash-based routing for public pages and the main app.
 *
 * Routes:
 * - #/         or no hash -> landing page (if not authenticated)
 * - #/pricing  -> pricing page
 * - #/register -> 3-step registration wizard
 * - #/app      -> main application (WorldScreen)
 *
 * The WorldScreen handles its own auth flow internally.
 */
export function AppRoutes() {
  const [route, setRoute] = React.useState<Route>('landing');

  const [verifyToken, setVerifyToken] = React.useState<string | undefined>();
  const [resetToken, setResetToken] = React.useState<string | undefined>();
  const [resetEmail, setResetEmail] = React.useState<string | undefined>();
  const [guestToken, setGuestToken] = React.useState<string | undefined>();
  const [inviteCode, setInviteCode] = React.useState<string | undefined>();

  // Parse initial route from hash
  React.useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) || '/';
      if (hash === '/pricing') {
        setRoute('pricing');
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
      } else if (hash.startsWith('/billing/success')) {
        setRoute('billing-success');
      } else if (hash.startsWith('/billing/cancel')) {
        setRoute('billing-cancel');
      } else if (hash === '/login') {
        setRoute('login');
      } else if (hash === '/register') {
        setRoute('register');
      } else if (hash === '/invite') {
        setRoute('invite');
      } else if (hash.startsWith('/reset')) {
        const params = new URLSearchParams(hash.split('?')[1] || '');
        setResetToken(params.get('token') || undefined);
        setResetEmail(params.get('email') || undefined);
        setRoute('reset-pw');
      } else if (hash.startsWith('/guest')) {
        const params = new URLSearchParams(hash.split('?')[1] || '');
        setGuestToken(params.get('token') || undefined);
        setRoute('guest-auth');
      } else if (hash === '/app' || hash.startsWith('/app')) {
        setRoute('app');
      } else {
        // Default: check if we should show landing or app
        // If there's a tenant subdomain or invite code, go directly to app
        const hostname = window.location.hostname;
        const isSubdomain = hostname.split('.').length > 2 && !hostname.startsWith('www.');

        // Check for invite code in hash params
        const hashQIdx = (window.location.hash || '').indexOf('?');
        const hasInvite = hashQIdx !== -1 && new URLSearchParams((window.location.hash || '').slice(hashQIdx)).has('invite');

        if (hasInvite) {
          const code = new URLSearchParams((window.location.hash || '').slice(hashQIdx)).get('invite') || undefined;
          setInviteCode(code);
          setRoute('invite');
        } else if (isSubdomain || !!(window as any).__MEETROPOLIS_API_BASE__) {
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

  const [registrationEnabled, setRegistrationEnabled] = React.useState<boolean>(true);

  React.useEffect(() => {
    fetch(`${apiBase}/public/config`)
      .then(r => r.json())
      .then(data => {
        if (typeof data.publicRegistrationEnabled === 'boolean') {
          setRegistrationEnabled(data.publicRegistrationEnabled);
        }
      })
      .catch(() => { /* fallback: true */ });
  }, [apiBase]);

  // Scroll to top on route change
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  // Scroll to pricing section when route is 'pricing'
  React.useEffect(() => {
    if (route === 'pricing') {
      // Allow DOM to render first, then scroll
      const timer = setTimeout(() => {
        document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [route]);

  switch (route) {
    case 'landing':
      return (
        <LandingPage
          onLogin={() => navigate('login')}
          onSignup={() => navigate('register')}
          onPricing={() => navigate('pricing')}
          registrationEnabled={registrationEnabled}
        />
      );

    case 'pricing':
      // Pricing is now a section on the landing page — render landing and scroll to #pricing
      return (
        <LandingPage
          onLogin={() => navigate('login')}
          onSignup={() => navigate('register')}
          onPricing={() => {}}
          registrationEnabled={registrationEnabled}
        />
      );

    case 'privacy':
      return <PrivacyPolicyPage onBack={() => navigate('landing')} />;

    case 'terms':
      return <TermsOfServicePage onBack={() => navigate('landing')} />;

    case 'impressum':
      return <ImpressumPage onBack={() => navigate('landing')} />;

    case 'verify':
      return (
        <EmailVerifyPage
          token={verifyToken}
          apiBase={apiBase}
          onSuccess={() => navigate('app')}
          onBack={() => navigate('landing')}
        />
      );

    case 'billing-success':
      return <BillingSuccessPage onNavigate={() => { window.location.hash = '#/app'; }} />;
    case 'billing-cancel':
      return <BillingCancelPage onNavigate={() => { window.location.hash = '#/app'; }} />;

    case 'login':
      return <AuthPage apiBase={apiBase} initialView="login" />;
    case 'register':
      return <AuthPage apiBase={apiBase} initialView="register" />;
    case 'invite':
      return <AuthPage apiBase={apiBase} initialView="invite" initialInvite={inviteCode} />;
    case 'reset-pw':
      return <AuthPage apiBase={apiBase} initialView="reset" initialResetToken={resetToken} initialResetEmail={resetEmail} />;
    case 'guest-auth':
      return <AuthPage apiBase={apiBase} initialView="guest" initialGuestToken={guestToken} />;

    case 'app':
    default:
      return <WorldScreen />;
  }
}

