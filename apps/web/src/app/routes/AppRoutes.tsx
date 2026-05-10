import * as React from 'react';
import { WorldScreen } from './WorldScreen';
import { LandingPage } from '../../ui/pub/landing/LandingPage';

import { getApiBaseFromWindow } from '../../lib/runtimeConfig';
import { usePublicConfigStore } from '../../state/publicConfigStore';
import { BillingSuccessPage } from '../../ui/pub/billing/BillingSuccessPage';
import { BillingCancelPage } from '../../ui/pub/billing/BillingCancelPage';
import { EmailVerifyPage } from '../../ui/pub/billing/EmailVerifyPage';
import { AuthPage } from '../../ui/pub/auth/AuthPage';
import { getBrandModule } from '../../lib/brandLoader';

type LegalPageProps = { onBack: () => void; registrationEnabled?: boolean };

const LegalUnavailable: React.ComponentType<LegalPageProps> = ({ onBack }) => (
  <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-subtle, #888)' }}>
    <p>Legal pages (Terms, Privacy, Impressum) are not bundled with the OSS edition.</p>
    <p>Self-hosters must provide their own legal documents.</p>
    <button onClick={onBack} style={{ marginTop: 16 }}>
      Back
    </button>
  </div>
);

const TermsOfServicePageLazy = React.lazy<React.ComponentType<LegalPageProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: LegalUnavailable };
  return { default: mod.TermsOfServicePage };
});

const PrivacyPolicyPageLazy = React.lazy<React.ComponentType<LegalPageProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: LegalUnavailable };
  return { default: mod.PrivacyPolicyPage };
});

const ImpressumPageLazy = React.lazy<React.ComponentType<LegalPageProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: LegalUnavailable };
  return { default: mod.ImpressumPage };
});

const PublicConsentGateLazy = React.lazy<React.ComponentType<Record<string, never>>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: () => null };
  return { default: mod.PublicConsentGate };
});

type Route =
  | 'landing'
  | 'pricing'
  | 'app'
  | 'privacy'
  | 'terms'
  | 'impressum'
  | 'verify'
  | 'billing-success'
  | 'billing-cancel'
  | 'login'
  | 'register'
  | 'invite'
  | 'guest-auth'
  | 'reset-pw';

type RouteParams = {
  verifyToken?: string;
  resetToken?: string;
  resetEmail?: string;
  guestToken?: string;
  inviteCode?: string;
};

function setOptional<K extends keyof RouteParams>(p: RouteParams, k: K, v: string | null) {
  if (v != null && v !== '') p[k] = v;
}

/** Parse hash + search-string → route + params */
function parseHashRoute(hash: string): { route: Route; params: RouteParams } {
  const params: RouteParams = {};
  const searchPart = hash.indexOf('?') >= 0 ? hash.slice(hash.indexOf('?')) : '';
  const path = hash.indexOf('?') >= 0 ? hash.slice(0, hash.indexOf('?')) : hash;

  if (path === '/pricing') return { route: 'pricing', params };
  if (path === '/privacy') return { route: 'privacy', params };
  if (path === '/terms') return { route: 'terms', params };
  if (path === '/impressum' || path === '/imprint') return { route: 'impressum', params };
  if (path.startsWith('/verify')) {
    const sp = new URLSearchParams(searchPart.slice(1));
    setOptional(params, 'verifyToken', sp.get('token'));
    return { route: 'verify', params };
  }
  if (path.startsWith('/billing/success')) return { route: 'billing-success', params };
  if (path.startsWith('/billing/cancel')) return { route: 'billing-cancel', params };
  if (path === '/login') return { route: 'login', params };
  if (path === '/register') return { route: 'register', params };
  if (path === '/invite') return { route: 'invite', params };
  if (path.startsWith('/reset')) {
    const sp = new URLSearchParams(searchPart.slice(1));
    setOptional(params, 'resetToken', sp.get('token'));
    setOptional(params, 'resetEmail', sp.get('email'));
    return { route: 'reset-pw', params };
  }
  if (path.startsWith('/guest')) {
    const sp = new URLSearchParams(searchPart.slice(1));
    setOptional(params, 'guestToken', sp.get('token'));
    return { route: 'guest-auth', params };
  }
  if (path === '/app' || path.startsWith('/app')) return { route: 'app', params };
  // Default fallback — check tenant subdomain / invite query
  const hostname = window.location.hostname;
  const isSubdomain = hostname.split('.').length > 2 && !hostname.startsWith('www.');
  const sp = new URLSearchParams(searchPart.slice(1));
  if (sp.has('invite')) {
    setOptional(params, 'inviteCode', sp.get('invite'));
    return { route: 'invite', params };
  }
  if (isSubdomain || !!window.__MEETROPOLIS_API_BASE__) return { route: 'app', params };
  return { route: 'landing', params };
}

function useHashRoute() {
  const [route, setRoute] = React.useState<Route>('landing');
  const [params, setParams] = React.useState<RouteParams>({});

  React.useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) || '/';
      const result = parseHashRoute(hash);
      setRoute(result.route);
      setParams(result.params);
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = React.useCallback((newRoute: Route, qp?: Record<string, string>) => {
    let hash = `#/${newRoute === 'landing' ? '' : newRoute}`;
    if (qp) {
      const sp = new URLSearchParams(qp);
      hash += `?${sp.toString()}`;
    }
    window.location.hash = hash;
    setRoute(newRoute);
  }, []);

  return { route, params, navigate, setRoute };
}

function usePublicConfig(apiBase: string): boolean {
  const registrationEnabled = usePublicConfigStore((s) => s.registrationEnabled);
  const load = usePublicConfigStore((s) => s.load);
  React.useEffect(() => {
    void load(apiBase);
  }, [apiBase, load]);
  return registrationEnabled;
}

function useScrollEffects(route: Route) {
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);
  React.useEffect(() => {
    if (route === 'pricing') {
      const timer = setTimeout(() => {
        document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [route]);
}

type RouteRenderProps = {
  route: Route;
  params: RouteParams;
  apiBase: string;
  registrationEnabled: boolean;
  navigate: (r: Route, qp?: Record<string, string>) => void;
};

function RouteContent({ route, params, apiBase, registrationEnabled, navigate }: RouteRenderProps): React.ReactElement {
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
      return (
        <LandingPage
          onLogin={() => navigate('login')}
          onSignup={() => navigate('register')}
          onPricing={() => {}}
          registrationEnabled={registrationEnabled}
        />
      );
    case 'privacy':
      return (
        <React.Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
          <PrivacyPolicyPageLazy onBack={() => navigate('landing')} registrationEnabled={registrationEnabled} />
        </React.Suspense>
      );
    case 'terms':
      return (
        <React.Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
          <TermsOfServicePageLazy onBack={() => navigate('landing')} registrationEnabled={registrationEnabled} />
        </React.Suspense>
      );
    case 'impressum':
      return (
        <React.Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
          <ImpressumPageLazy onBack={() => navigate('landing')} registrationEnabled={registrationEnabled} />
        </React.Suspense>
      );
    case 'verify':
      return (
        <EmailVerifyPage
          token={params.verifyToken}
          apiBase={apiBase}
          onSuccess={() => navigate('app')}
          onBack={() => navigate('landing')}
        />
      );
    case 'billing-success':
      return (
        <BillingSuccessPage
          onNavigate={() => {
            window.location.hash = '#/app';
          }}
        />
      );
    case 'billing-cancel':
      return (
        <BillingCancelPage
          onNavigate={() => {
            window.location.hash = '#/app';
          }}
        />
      );
    case 'login':
      return <AuthPage apiBase={apiBase} initialView="login" registrationEnabled={registrationEnabled} />;
    case 'register':
      return <AuthPage apiBase={apiBase} initialView="register" registrationEnabled={registrationEnabled} />;
    case 'invite':
      return (
        <AuthPage
          apiBase={apiBase}
          initialView="invite"
          initialInvite={params.inviteCode}
          registrationEnabled={registrationEnabled}
        />
      );
    case 'reset-pw':
      return (
        <AuthPage
          apiBase={apiBase}
          initialView="reset"
          initialResetToken={params.resetToken}
          initialResetEmail={params.resetEmail}
        />
      );
    case 'guest-auth':
      return <AuthPage apiBase={apiBase} initialView="guest" initialGuestToken={params.guestToken} />;
    case 'app':
    default:
      return <WorldScreen />;
  }
}

/**
 * Simple hash-based routing for public pages and the main app.
 * The WorldScreen handles its own auth flow internally.
 */
export function AppRoutes() {
  const { route, params, navigate } = useHashRoute();
  const apiBase = getApiBaseFromWindow();
  const registrationEnabled = usePublicConfig(apiBase);

  React.useEffect(() => {
    if (!registrationEnabled && route === 'register') {
      navigate('login');
    }
  }, [registrationEnabled, route, navigate]);

  useScrollEffects(route);

  return (
    <>
      <RouteContent
        route={route}
        params={params}
        apiBase={apiBase}
        registrationEnabled={registrationEnabled}
        navigate={navigate}
      />
      <React.Suspense fallback={null}>
        <PublicConsentGateLazy />
      </React.Suspense>
    </>
  );
}
