import * as React from 'react';
import { WorldScreen } from './WorldScreen';
import { LandingPage, PricingPage, TenantSignupPage } from '../../ui/public';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';

type Route = 'landing' | 'pricing' | 'signup' | 'app';

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

    case 'app':
    default:
      return <WorldScreen />;
  }
}
