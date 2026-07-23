import React from 'react';

export type Route =
  | 'landing'
  | 'pricing'
  | 'app'
  | 'privacy'
  | 'terms'
  | 'impressum'
  | 'download'
  | 'verify'
  | 'billing-success'
  | 'billing-cancel'
  | 'login'
  | 'register'
  | 'invite'
  | 'guest-auth'
  | 'reset-pw';

export type RouteParams = {
  verifyToken?: string;
  resetToken?: string;
  resetEmail?: string;
  guestToken?: string;
  inviteCode?: string;
  /** Preselected pricing tier carried from the landing pricing cards into the
   * registration wizard (e.g. `#/register?plan=team`). Validated against the
   * live catalog in step 3, so an unknown value falls back to the default. */
  plan?: string;
  /** Stripe Checkout Session id from the success return URL
   * (`#/billing/success?session_id=cs_…`). Handed to POST /billing/reconcile so
   * the office is provisioned even when the webhook is late or lost. */
  sessionId?: string;
};

function setOptional<K extends keyof RouteParams>(p: RouteParams, k: K, v: string | null) {
  if (v != null && v !== '') p[k] = v;
}

/**
 * Accept a tier identifier only if it really is one.
 *
 * The signup CTAs are handed to the closed-source brand module, whose hero
 * wires its button as `onClick={onSignup}` — React then calls it with the click
 * event, not a tier. Stringifying that produced `#/register?plan=[object
 * Object]`. The call convention across a loader boundary is not ours to trust,
 * so the value is validated here instead: a tier key is a short slug, anything
 * else means "no preselection".
 */
export function sanitizeTierKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 64) return undefined;
  return /^[a-z0-9][a-z0-9_-]*$/i.test(trimmed) ? trimmed : undefined;
}

/** Parse hash + search-string → route + params */
export function parseHashRoute(hash: string): { route: Route; params: RouteParams } {
  const params: RouteParams = {};
  const searchPart = hash.indexOf('?') >= 0 ? hash.slice(hash.indexOf('?')) : '';
  const path = hash.indexOf('?') >= 0 ? hash.slice(0, hash.indexOf('?')) : hash;

  if (path === '/pricing') return { route: 'pricing', params };
  if (path === '/privacy') return { route: 'privacy', params };
  if (path === '/terms') return { route: 'terms', params };
  if (path === '/impressum' || path === '/imprint') return { route: 'impressum', params };
  if (path === '/download' || path === '/desktop') return { route: 'download', params };
  if (path.startsWith('/verify')) {
    const sp = new URLSearchParams(searchPart.slice(1));
    setOptional(params, 'verifyToken', sp.get('token'));
    return { route: 'verify', params };
  }
  if (path.startsWith('/billing/success')) {
    const sp = new URLSearchParams(searchPart.slice(1));
    setOptional(params, 'sessionId', sp.get('session_id'));
    return { route: 'billing-success', params };
  }
  if (path.startsWith('/billing/cancel')) return { route: 'billing-cancel', params };
  if (path === '/login') return { route: 'login', params };
  if (path === '/register') {
    const sp = new URLSearchParams(searchPart.slice(1));
    setOptional(params, 'plan', sp.get('plan'));
    return { route: 'register', params };
  }
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
  // Default fallback: check tenant subdomain or invite query.
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

export function currentHashRoute(): { route: Route; params: RouteParams } {
  const hash = (typeof window !== 'undefined' ? window.location.hash.slice(1) : '') || '/';
  return parseHashRoute(hash);
}

export function useHashRoute() {
  // Initialise from the actual hash, not a hardcoded 'landing'. A first render
  // that always claims 'landing' makes the brand-absent redirect effect (which
  // sends BRAND_ONLY_ROUTES to /login) fire against a stale route before the
  // hash is parsed. On a reload of e.g. #/app in a hasBrand=false build
  // (desktop app, pure OSS self-host) that race clobbers the hash with
  // #/login, so the world never mounts and the session appears lost.
  const initial = currentHashRoute();
  const [route, setRoute] = React.useState<Route>(initial.route);
  const [params, setParams] = React.useState<RouteParams>(initial.params);

  React.useEffect(() => {
    const handleHashChange = () => {
      const result = currentHashRoute();
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
