import * as React from 'react';
import { ConsentBanner } from './ConsentBanner';
import {
  getMarketingConsent,
  onMarketingConsentChange,
} from '../../../lib/marketingConsent';
import {
  isDesktopRuntime,
  loadMetaPixel,
  trackMetaPageView,
} from '../../../lib/metaPixel';

const META_PIXEL_ID = '1878721026864311';

/**
 * Routes on which marketing tracking is allowed. Must stay in sync with the
 * public route set in `AppRoutes.tsx`. The authenticated `app` route is the
 * single non-public destination today, but we gate explicitly on the allow-list
 * to avoid accidentally tracking future internal screens.
 */
const PUBLIC_ROUTE_PREFIXES = [
  '/', // landing (empty hash)
  '/pricing',
  '/privacy',
  '/terms',
  '/impressum',
  '/imprint',
  '/verify',
  '/billing/success',
  '/billing/cancel',
  '/login',
  '/register',
  '/invite',
  '/reset',
  '/guest',
];

function isPublicHash(rawHash: string): boolean {
  const withoutLeading = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const pathOnly = withoutLeading.split('?')[0] || '/';
  // Anything that starts with /app (including bare "/app") is the authenticated
  // workspace — never track there.
  if (pathOnly === '/app' || pathOnly.startsWith('/app/')) return false;
  if (pathOnly === '' || pathOnly === '/') return true;
  return PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`) || pathOnly.startsWith(`${prefix}?`),
  );
}

function readCurrentHash(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hash || '';
}

/**
 * Mounts the cookie-consent banner and wires up the Meta Pixel lifecycle
 * for the public-facing site. This is the single integration point that
 * `AppRoutes` renders alongside the routed content.
 *
 * - The banner appears only on public routes and only while no choice has
 *   been stored in `localStorage`.
 * - The pixel is loaded on the first grant, never in the Tauri desktop shell,
 *   and re-fires a `PageView` on every SPA hash change while consent is active.
 */
export function PublicConsentGate() {
  const desktop = React.useMemo(() => isDesktopRuntime(), []);
  const [isPublic, setIsPublic] = React.useState<boolean>(() => isPublicHash(readCurrentHash()));

  // Track hash changes so we can (a) hide the banner on non-public routes and
  // (b) fire a synthetic PageView per SPA navigation.
  React.useEffect(() => {
    const onHashChange = () => {
      const nowPublic = isPublicHash(readCurrentHash());
      setIsPublic(nowPublic);
      if (nowPublic && getMarketingConsent() === 'granted' && !desktop) {
        trackMetaPageView();
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [desktop]);

  // If consent is already granted when the app mounts on a public route,
  // load the pixel immediately.
  React.useEffect(() => {
    if (desktop) return;
    if (!isPublic) return;
    if (getMarketingConsent() !== 'granted') return;
    loadMetaPixel(META_PIXEL_ID);
  }, [desktop, isPublic]);

  // Respond to future consent changes (banner click or "reset" from the footer).
  React.useEffect(() => {
    if (desktop) return;
    const unsubscribe = onMarketingConsentChange((next) => {
      if (next === 'granted' && isPublicHash(readCurrentHash())) {
        loadMetaPixel(META_PIXEL_ID);
      }
    });
    return unsubscribe;
  }, [desktop]);

  if (desktop) return null;

  return (
    <ConsentBanner
      enabled={isPublic}
      onAccept={() => {
        if (isPublicHash(readCurrentHash())) {
          loadMetaPixel(META_PIXEL_ID);
        }
      }}
    />
  );
}
