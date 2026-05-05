/**
 * Meta Pixel (Facebook) loader with consent-gated initialization.
 *
 * This module injects the Meta Pixel snippet at runtime — never at build time —
 * and only when the user has explicitly granted marketing consent via the
 * on-page consent banner. It is also restricted to the public website: it
 * must not run in the Tauri desktop shell or inside the authenticated app.
 *
 * Usage:
 *   loadMetaPixel(pixelId) — idempotent; injects script + noscript fallback
 *     and fires an initial `PageView` event.
 *   trackMetaPageView()    — fires a subsequent `PageView` on SPA route change
 *     (no-op if the pixel has not been loaded yet).
 */

// Keep the global fbq typing lightweight and local to this module.
type FbqFn = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
};

interface MetaPixelWindow {
  fbq?: FbqFn;
  _fbq?: FbqFn;
  __META_PIXEL_LOADED__?: boolean;
  __MEETROPOLIS_API_BASE__?: string;
  __TAURI__?: unknown;
}

function pxWindow(): MetaPixelWindow {
  // Centralised, locally-typed view of the window object. Avoids clashing
  // with global.d.ts augmentations that already declare other Window fields.
  return window as unknown as MetaPixelWindow;
}

const NOSCRIPT_ID = 'meta-pixel-noscript';
const SCRIPT_SRC = 'https://connect.facebook.net/en_US/fbevents.js';

/**
 * Returns true when the current runtime is the Tauri desktop shell.
 * The Meta Pixel must not load in desktop builds — those users never see
 * the marketing pages and the tracker would leak native-app telemetry.
 */
export function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const w = pxWindow();
    if (typeof w.__MEETROPOLIS_API_BASE__ === 'string' && w.__MEETROPOLIS_API_BASE__) {
      return true;
    }
    if (typeof w.__TAURI__ !== 'undefined') {
      return true;
    }
  } catch {
    // ignore — treat SSR/restricted contexts as non-desktop.
  }
  return false;
}

/**
 * Injects the Meta Pixel snippet, initializes the pixel, and fires the first
 * PageView event. Safe to call multiple times — subsequent calls return early.
 */
export function loadMetaPixel(pixelId: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const w = pxWindow();
  if (w.__META_PIXEL_LOADED__ || w.fbq) return;
  if (!pixelId) return;

  // Inline implementation of the official Meta Pixel bootstrap snippet.
  // Translated to TypeScript to avoid `eval`-style injection and to keep
  // bundler + strict mode happy.
  const init = (): void => {
    if (w.fbq) return;

    const n: FbqFn = function (this: unknown, ...args: unknown[]) {
      if (n.callMethod) {
        n.callMethod.apply(this, args);
      } else {
        (n.queue as unknown[]).push(args);
      }
    } as FbqFn;

    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];

    w.fbq = n;
    if (!w._fbq) {
      w._fbq = n;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = SCRIPT_SRC;
    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }
  };

  init();

  const fbq: FbqFn | undefined = w.fbq;
  if (fbq) {
    (fbq as FbqFn)('init', pixelId);
    (fbq as FbqFn)('track', 'PageView');
  }

  // <noscript> fallback image — rendered even for non-JS scrapers. We inject it
  // into <body> to mirror the default placement recommended by Meta.
  try {
    if (!document.getElementById(NOSCRIPT_ID)) {
      const ns = document.createElement('noscript');
      ns.id = NOSCRIPT_ID;
      const img = document.createElement('img');
      img.height = 1;
      img.width = 1;
      img.style.display = 'none';
      img.src = `https://www.facebook.com/tr?id=${encodeURIComponent(pixelId)}&ev=PageView&noscript=1`;
      img.alt = '';
      ns.appendChild(img);
      document.body.appendChild(ns);
    }
  } catch {
    // best-effort: <noscript> fallback is a nice-to-have.
  }

  w.__META_PIXEL_LOADED__ = true;
}

/**
 * Fires a `PageView` for the current SPA route. No-op when the pixel has not
 * been loaded (i.e. consent was not granted or we are off the public site).
 */
export function trackMetaPageView(): void {
  if (typeof window === 'undefined') return;
  const fbq: FbqFn | undefined = pxWindow().fbq;
  if (!fbq) return;
  try {
    (fbq as FbqFn)('track', 'PageView');
  } catch {
    // never throw from a tracker
  }
}
