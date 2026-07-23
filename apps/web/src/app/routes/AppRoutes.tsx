import * as React from 'react';
import { WorldScreen } from './WorldScreen';
import { LandingPage } from '../../ui/pub/landing/LandingPage';
import { DesktopDownloadPage } from '../../ui/pub/download/DesktopDownloadPage';

import { getApiBaseFromWindow } from '../../lib/runtimeConfig';
import { usePublicConfigStore } from '../../state/publicConfigStore';
import { BillingSuccessPage } from '../../ui/pub/billing/BillingSuccessPage';
import { BillingCancelPage } from '../../ui/pub/billing/BillingCancelPage';
import { EmailVerifyPage } from '../../ui/pub/billing/EmailVerifyPage';
import { AuthPage } from '../../ui/pub/auth/AuthPage';
import { useTranslation } from 'react-i18next';
import { getBrandModule, useHasBrandModule } from '../../lib/brandLoader';
import { SimpleLegalNotice } from '../../ui/pub/legal/SimpleLegalNotice';
import { DesktopUpdateOverlay } from './components/DesktopUpdateOverlay';
import { sanitizeTierKey, useHashRoute, type Route, type RouteParams } from './useHashRoute';

/**
 * Build the `?plan=` query for a signup CTA. The tier arrives from the brand
 * module across the loader boundary, so it is validated rather than trusted —
 * an unusable value simply means no preselection (step 3 falls back to its
 * default) instead of a `plan=[object Object]` in the address bar.
 */
function toPlanQuery(tierKey: unknown): Record<string, string> | undefined {
  const tier = sanitizeTierKey(tierKey);
  return tier ? { plan: tier } : undefined;
}

type LegalPageProps = { onBack: () => void; registrationEnabled?: boolean };

const TermsOfServicePageLazy = React.lazy<React.ComponentType<LegalPageProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: SimpleLegalNotice };
  return { default: mod.TermsOfServicePage };
});

const PrivacyPolicyPageLazy = React.lazy<React.ComponentType<LegalPageProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: SimpleLegalNotice };
  return { default: mod.PrivacyPolicyPage };
});

const ImpressumPageLazy = React.lazy<React.ComponentType<LegalPageProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: SimpleLegalNotice };
  return { default: mod.ImpressumPage };
});

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
          onSignup={(tierKey) => navigate('register', toPlanQuery(tierKey))}
          onPricing={() => navigate('pricing')}
          registrationEnabled={registrationEnabled}
        />
      );
    case 'pricing':
      return (
        <LandingPage
          onLogin={() => navigate('login')}
          onSignup={(tierKey) => navigate('register', toPlanQuery(tierKey))}
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
    case 'download':
      return (
        <DesktopDownloadPage
          apiBase={apiBase}
          onLogin={() => navigate('login')}
          onSignup={(tierKey) => navigate('register', toPlanQuery(tierKey))}
          registrationEnabled={registrationEnabled}
        />
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
          apiBase={apiBase}
          sessionId={params.sessionId}
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
      return (
        <AuthPage
          apiBase={apiBase}
          initialView="register"
          initialPlan={params.plan}
          registrationEnabled={registrationEnabled}
        />
      );
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
/**
 * OSS edition only ships authentication + the world app. Marketing landing,
 * pricing and the legal pages live in the closed-source brand module; when
 * that module is absent we treat their hash routes as if they were /login.
 */
const BRAND_ONLY_ROUTES: ReadonlyArray<Route> = ['landing', 'pricing', 'privacy', 'terms', 'impressum', 'download'];

/**
 * Sync document.title with the i18n key `header.documentTitle`. The OSS
 * default ("Meetropolis · Self-Hosted Edition") is overridden whenever
 * the brand module's marketingDe / marketingEn catalog ships a different
 * value (e.g. "Meetropolis Cloud" for the Tiamat-hosted build).
 */
function useDocumentTitle() {
  const { t } = useTranslation('public');
  React.useEffect(() => {
    const raw = t('header.documentTitle');
    if (raw && raw !== 'header.documentTitle') {
      document.title = raw;
    }
  }, [t]);
}

/**
 * Sync the <html lang="…"> attribute with the active i18n language. The
 * HTML file ships a static fallback of `de` (matching the seed admin
 * locale); this hook keeps the attribute aligned with i18next whenever
 * the user switches language, which matters for screen readers, browser
 * translation heuristics, and search-engine indexing.
 */
function useDocumentLang() {
  const { i18n } = useTranslation();
  React.useEffect(() => {
    const lang = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
    if (lang && typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [i18n, i18n.resolvedLanguage, i18n.language]);
}

export function AppRoutes() {
  const { route, params, navigate } = useHashRoute();
  const apiBase = getApiBaseFromWindow();
  const registrationEnabled = usePublicConfig(apiBase);
  const { loading: brandLoading, hasBrand } = useHasBrandModule();

  React.useEffect(() => {
    if (!registrationEnabled && route === 'register') {
      navigate('login');
    }
  }, [registrationEnabled, route, navigate]);

  React.useEffect(() => {
    if (brandLoading) return;
    if (hasBrand) return;
    if (BRAND_ONLY_ROUTES.includes(route)) {
      navigate('login');
    }
  }, [brandLoading, hasBrand, route, navigate]);

  useScrollEffects(route);
  useDocumentTitle();
  useDocumentLang();

  // While the brand module is still resolving, suppress the initial landing
  // flash for OSS users who would otherwise see one render tick of the
  // marketing layout before the redirect fires.
  if (brandLoading && BRAND_ONLY_ROUTES.includes(route)) {
    return null;
  }

  return (
    <>
      <RouteContent
        route={route}
        params={params}
        apiBase={apiBase}
        registrationEnabled={registrationEnabled}
        navigate={navigate}
      />
      {/* Above the auth gate so update notifications reach the login screen too. */}
      <DesktopUpdateOverlay />
    </>
  );
}
