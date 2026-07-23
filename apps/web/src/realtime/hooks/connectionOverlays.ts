/**
 * DOM overlay renderers for terminal Colyseus join/connection errors.
 *
 * Extracted from useColyseusConnection.ts (LoC budget) - these are pure
 * side-effecting DOM helpers with no hook state, so they have no
 * dependency on the connection hook itself.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Plug, Timer, TriangleAlert } from 'lucide-react';
import i18n from '../../app/providers/i18n';

// Inline SVG markup for lucide icons, rendered once at module load so they can
// be injected into innerHTML overlays without React. Keeping the icons inline
// preserves visual parity with the previous emoji glyphs (size 48px).
const TIMER_ICON_SVG = renderToStaticMarkup(createElement(Timer, { size: 48 }));
const PLUG_ICON_SVG = renderToStaticMarkup(createElement(Plug, { size: 48 }));
const ALERT_ICON_SVG = renderToStaticMarkup(createElement(TriangleAlert, { size: 48 }));

export function showGuestExpiredOverlay(apiBase: string): void {
  try {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;';
    host.innerHTML = `
      <div style="min-width:320px;max-width:480px;padding:24px;border-radius:12px;border:1px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.15);backdrop-filter:blur(8px);color:var(--fg,#fff);box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;">
        <div style="display:flex;justify-content:center;margin-bottom:12px;">${TIMER_ICON_SVG}</div>
        <div style="font-weight:700;font-size:18px;margin-bottom:8px;">${i18n.t('realtime.guestExpired.title')}</div>
        <div style="font-size:14px;color:var(--fg-subtle,#ccc);margin-bottom:16px;">${i18n.t('realtime.guestExpired.description')}</div>
        <button data-guest-expired-ok style="padding:10px 20px;border-radius:8px;border:none;background:var(--accent,#3b82f6);color:white;cursor:pointer;font-weight:600;">${i18n.t('realtime.guestExpired.button')}</button>
      </div>`;
    document.body.appendChild(host);
    host.querySelector('[data-guest-expired-ok]')?.addEventListener(
      'click',
      () => {
        try {
          host.remove();
        } catch {}
        try {
          void fetch(apiBase + '/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => {
            window.location.hash = '#/app';
            window.location.reload();
          });
        } catch {
          window.location.reload();
        }
      },
      { once: true },
    );
  } catch {}
}

// H4 hardening: server rejected the join because the session is no longer
// authenticated (code 4401, see rooms/lifecycle/onAuth.ts). Distinct from
// showGuestExpiredOverlay: this covers any expired/invalid auth_token, not
// only guests. Re-login is the only way forward, so this does not
// auto-reconnect.
export function showAuthExpiredOverlay(apiBase: string): void {
  try {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;';
    host.innerHTML = `
      <div style="min-width:320px;max-width:480px;padding:24px;border-radius:12px;border:1px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.15);backdrop-filter:blur(8px);color:var(--fg,#fff);box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;">
        <div style="display:flex;justify-content:center;margin-bottom:12px;">${TIMER_ICON_SVG}</div>
        <div style="font-weight:700;font-size:18px;margin-bottom:8px;">${i18n.t('realtime.authExpired.title')}</div>
        <div style="font-size:14px;color:var(--fg-subtle,#ccc);margin-bottom:16px;">${i18n.t('realtime.authExpired.description')}</div>
        <button data-auth-expired-ok style="padding:10px 20px;border-radius:8px;border:none;background:var(--accent,#3b82f6);color:white;cursor:pointer;font-weight:600;">${i18n.t('realtime.authExpired.button')}</button>
      </div>`;
    document.body.appendChild(host);
    host.querySelector('[data-auth-expired-ok]')?.addEventListener(
      'click',
      () => {
        try {
          host.remove();
        } catch {}
        try {
          void fetch(apiBase + '/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => {
            window.location.hash = '#/app';
            window.location.reload();
          });
        } catch {
          window.location.reload();
        }
      },
      { once: true },
    );
  } catch {}
}

// H4 hardening: server rejected the join because this build's
// zonePrivacyVersion is below MIN_ZONE_PRIVACY_CLIENT_VERSION (code 4426,
// see rooms/lifecycle/onAuth.ts). Should not happen for an up-to-date OSS
// build (colyseus.ts always sends the current constant); guards against an
// endless reconnect loop if it ever does (e.g. a stale cached bundle).
export function showClientTooOldOverlay(): void {
  try {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;';
    host.innerHTML = `
      <div style="min-width:320px;max-width:480px;padding:24px;border-radius:12px;border:1px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.15);backdrop-filter:blur(8px);color:var(--fg,#fff);box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;">
        <div style="display:flex;justify-content:center;margin-bottom:12px;">${ALERT_ICON_SVG}</div>
        <div style="font-weight:700;font-size:18px;margin-bottom:8px;">${i18n.t('realtime.clientTooOld.title')}</div>
        <div style="font-size:14px;color:var(--fg-subtle,#ccc);margin-bottom:16px;">${i18n.t('realtime.clientTooOld.description')}</div>
        <button data-client-too-old-ok style="padding:10px 20px;border-radius:8px;border:none;background:var(--accent,#3b82f6);color:white;cursor:pointer;font-weight:600;">${i18n.t('realtime.clientTooOld.button')}</button>
      </div>`;
    document.body.appendChild(host);
    host.querySelector('[data-client-too-old-ok]')?.addEventListener(
      'click',
      () => {
        try {
          host.remove();
        } catch {}
        window.location.reload();
      },
      { once: true },
    );
  } catch {}
}

export function showSessionTakenOverOverlay(): void {
  try {
    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
    host.innerHTML = `
      <div style="min-width:320px;max-width:480px;padding:24px;border-radius:12px;border:1px solid rgba(234,88,12,0.5);background:rgba(30,41,59,0.95);backdrop-filter:blur(8px);color:#fff;box-shadow:0 8px 32px rgba(0,0,0,0.4);text-align:center;">
        <div style="display:flex;justify-content:center;margin-bottom:12px;">${PLUG_ICON_SVG}</div>
        <div style="font-weight:700;font-size:18px;margin-bottom:8px;">${i18n.t('sessionConflict.takenOver.title')}</div>
        <div style="font-size:14px;color:#94a3b8;margin-bottom:20px;">${i18n.t('sessionConflict.takenOver.description')}</div>
        <button data-session-reload style="padding:10px 20px;border-radius:8px;border:none;background:#3b82f6;color:white;cursor:pointer;font-weight:600;font-size:14px;">${i18n.t('sessionConflict.takenOver.reconnect')}</button>
      </div>`;
    document.body.appendChild(host);
    host.querySelector('[data-session-reload]')?.addEventListener(
      'click',
      () => {
        try {
          host.remove();
        } catch {}
        window.location.reload();
      },
      { once: true },
    );
  } catch {}
}

// Resolve localized title + description for a terminal limit/billing close
// code. Uses the customer term "gleichzeitige Teilnehmer" / "concurrent
// participants" for the tenant seat cap (4001, E1.3/E3.5).
function resolveLimitTitleAndDesc(code: number | undefined, text: string): { title: string; description: string } {
  if (code === 4005 || text === 'trial_expired') {
    return {
      title: i18n.t('realtime.limit.trialExpired.title'),
      description: i18n.t('realtime.limit.trialExpired.description'),
    };
  }
  if (code === 4004 || text === 'subscription_suspended') {
    return {
      title: i18n.t('realtime.limit.suspended.title'),
      description: i18n.t('realtime.limit.suspended.description'),
    };
  }
  if (code === 4003 || text === 'subscription_inactive') {
    return {
      title: i18n.t('realtime.limit.inactive.title'),
      description: i18n.t('realtime.limit.inactive.description'),
    };
  }
  if (code === 4002 || text === 'oss_limit_reached') {
    return {
      title: i18n.t('realtime.limit.oss.title'),
      description: i18n.t('realtime.limit.oss.description'),
    };
  }
  return {
    title: i18n.t('realtime.limit.tenant.title'),
    description: i18n.t('realtime.limit.tenant.description'),
  };
}

export function showLimitErrorOverlay(code: number | undefined, text: string, onRetry: () => void): void {
  const { title, description } = resolveLimitTitleAndDesc(code, text);
  try {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;';
    host.innerHTML = `
      <div style="min-width:320px;max-width:480px;padding:24px;border-radius:12px;border:1px solid rgba(234,88,12,0.5);background:rgba(234,88,12,0.15);backdrop-filter:blur(8px);color:var(--fg,#fff);box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;">
        <div style="display:flex;justify-content:center;margin-bottom:12px;">${ALERT_ICON_SVG}</div>
        <div style="font-weight:700;font-size:18px;margin-bottom:8px;">${title}</div>
        <div style="font-size:14px;color:var(--fg-subtle,#ccc);margin-bottom:16px;">${description}</div>
        <button data-limit-retry style="padding:10px 20px;border-radius:8px;border:none;background:var(--accent,#3b82f6);color:white;cursor:pointer;font-weight:600;">${i18n.t('realtime.limit.retry')}</button>
      </div>`;
    document.body.appendChild(host);
    const retry = () => {
      try {
        host.remove();
      } catch {}
      onRetry();
    };
    host.querySelector('[data-limit-retry]')?.addEventListener('click', retry, { once: true });
  } catch {}
}
