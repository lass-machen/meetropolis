/**
 * Telemetry module loader (conditional loading pattern).
 *
 * Counterpart to desktopLoader.ts. Tries to load @meetropolis/telemetry-web via
 * dynamic import. When the module is missing — every pure OSS build, where the
 * optionalSubmodules plugin resolves the bare specifier to `export default null;`
 * — the loader falls back to a graceful null result so callers stay no-op and no
 * tracker code ever ships in the open-source bundle ("no phone-home" by
 * construction).
 *
 * Shape contract mirrors the enterprise `TelemetryWebModule` (structural check,
 * like desktopLoader.ts): the host only relies on a callable `initTelemetry`; the
 * rest of the surface lets the route effect drive pageview tracking without
 * coupling the OSS app to the telemetry provider's internals. This client tree
 * deliberately never names the proprietary tracker, so a pure OSS clone's
 * shipped client bundle and sourcemap reveal no vendor identity. (The OSS
 * server, by contrast, names the relay's server-side env contract — that is the
 * host-side integration surface, never shipped to browsers.)
 */

export interface TelemetryModule {
  /**
   * Initialise browser telemetry (the provider's SDK, proxy mode, error-observing
   * base). The module fetches `/public/config` itself to learn whether telemetry
   * is enabled server-side; a no-op when disabled. Async so the config fetch can
   * be awaited before the app mounts.
   */
  initTelemetry: () => Promise<void>;
  /**
   * Notify the tracker of a client-side route change. The module emits a pageview
   * only for public routes (web only); on `/app` routes it does nothing. Any
   * consent posture is the telemetry provider's concern, not decided here. No-op
   * before `initTelemetry` has run or when disabled.
   */
  onRouteChange: (path: string) => void;
  /**
   * Record that a registration completed. Vendor-neutral product event — the
   * module decides whether and how to forward it (web and desktop). No-op before
   * init or when disabled.
   *
   * @param method Optional signup-shape tag distinguishing a brand-new tenant
   * ('tenant_create', fired from useTenantCreation.ts) from joining an existing
   * tenant via an invite code ('invite', fired from useAuthHandlers.ts). Additive
   * and optional so the existing call site that omits it keeps compiling
   * unchanged. Whether the enterprise telemetry module actually forwards this tag
   * downstream to Signalyr is that package's concern, not this loader's.
   */
  trackSignup: (method?: 'tenant_create' | 'invite') => void;
  /**
   * Record that a login completed. Same forwarding as `trackSignup` (web and
   * desktop).
   */
  trackLogin: () => void;
  /**
   * Record that a checkout started. The module forwards this on the public web
   * only; never in the desktop app.
   */
  trackBeginCheckout: () => void;
  /**
   * Record that a trial actually started — fired from the post-checkout
   * thank-you page once the workspace has been provisioned, never on a failed
   * or still-pending reconcile and never for a pack purchase. Web only.
   *
   * This is the browser-side counterpart of the server's `begin_trial`: an ads
   * conversion can only be attributed from a browser that still holds the click
   * id, so the funnel needs this event client-side until server-side tracking
   * lands. The two carry different names on purpose so they cannot double-count.
   */
  trackTrialStarted: (properties?: { concurrentLimit?: number | null }) => void;
}

let cached: TelemetryModule | null | undefined = undefined; // undefined = not yet tried

/**
 * Load the telemetry module when available.
 * Returns null when the module is missing (OSS build).
 */
export async function getTelemetryModule(): Promise<TelemetryModule | null> {
  if (cached !== undefined) return cached;

  try {
    // @meetropolis/telemetry-web is an optional closed-source package.
    // In OSS builds it is absent, so the import resolves to null and the
    // shape check below fails into the null fallback.
    const mod = (await import('@meetropolis/telemetry-web')) as unknown as {
      default?: unknown;
      initTelemetry?: unknown;
    };
    const resolved: unknown = mod.default ?? mod;
    // Confirm the module actually exposes telemetry features.
    // In OSS builds (no package) the Vite plugin returns an empty module (null).
    if (
      !resolved ||
      typeof resolved !== 'object' ||
      typeof (resolved as { initTelemetry?: unknown }).initTelemetry !== 'function'
    ) {
      cached = null;
      return null;
    }
    cached = resolved as TelemetryModule;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}
