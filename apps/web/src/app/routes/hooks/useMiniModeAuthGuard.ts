/**
 * useMiniModeAuthGuard hook.
 *
 * The desktop client can shrink its window to a 340x520 point mini window (see
 * the desktop module's Rust side, `MINI_WIDTH` / `MINI_HEIGHT`). That size is
 * meant for the world view only, so the client leaves it while a public page is
 * showing and returns to it once the world is up again.
 *
 * The hook only *reports* which kind of page is on screen; the desktop side
 * decides what that means for the window. That split is deliberate: the two
 * facts the decision needs — the mini mode the user asked for, and whether they
 * opened the mini window on a public page themselves — have to survive a webview
 * reload (the login flow, "Neu laden", the reset path and the session-expiry
 * overlay all reload the page), and only the native side does.
 *
 * Hence three states instead of a boolean, and two callers that each report only
 * what they can actually know:
 *
 * - `'public'` — AppRoutes, for every route except the world. Authoritative:
 *   login, register, password reset, invite, billing and the legal pages are all
 *   full-width layouts, and the world route is the only one a session can reach.
 * - `'world'` — MiniModeWorldSignal, which is mounted exactly while the world is
 *   on screen, i.e. after the auth check said yes.
 * - `'unknown'` — the world route while the auth verdict is still pending. The
 *   window keeps whatever mode it has: shrinking before the verdict is what put
 *   the login page into a 340px window in the first place, and expanding before
 *   it would flap the window on every reload.
 *
 * Outside the desktop app the hook resolves to nothing: `isTauri` is false in an
 * OSS build without the desktop module, and in the hosted build — where the
 * module *is* bundled, so `isTauri` is true even in Chrome — `window.__DESKTOP__`
 * is absent and every bridge call is a no-op (see useDesktop).
 */

import { useEffect } from 'react';
import { logger } from '../../../lib/logger';
import { useDesktop } from './useDesktop';

/** What the webview is showing, as far as the caller can tell. */
export type MiniModePage = 'world' | 'public' | 'unknown';

export function useMiniModeAuthGuard(page: MiniModePage): void {
  const { isTauri, setWorldVisible } = useDesktop();

  useEffect(() => {
    if (!isTauri) return;
    // Nothing to report yet. Not a missing case: see the 'unknown' note above.
    if (page === 'unknown') return;

    // Fire and forget. Every call carries the absolute state rather than a
    // delta, so even a late answer cannot leave the window inverted — the next
    // page change re-states the truth.
    void setWorldVisible(page === 'world').catch((e) => {
      // Window sizing is a comfort feature: a failed bridge call must not take
      // the app down. The desktop bridge already logs the underlying error.
      logger.debug('[MiniModeAuthGuard] Failed to report the visible page', e);
    });
  }, [page, isTauri, setWorldVisible]);
}
