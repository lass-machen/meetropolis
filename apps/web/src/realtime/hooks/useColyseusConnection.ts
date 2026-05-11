import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Plug, Timer, TriangleAlert } from 'lucide-react';
import { joinWorld } from '../../lib/colyseus';
import { logger } from '../../lib/logger';
import { useMapStore } from '../../state/mapStore';
import type { UseWorldRoomArgs, ConnectionRefs } from '../types';
import type { WorldRoom } from '../../types/colyseus';
import i18n from '../../app/providers/i18n';

// Inline SVG markup for lucide icons, rendered once at module load so they can
// be injected into innerHTML overlays without React. Keeping the icons inline
// preserves visual parity with the previous emoji glyphs (size 48px).
const TIMER_ICON_SVG = renderToStaticMarkup(createElement(Timer, { size: 48 }));
const PLUG_ICON_SVG = renderToStaticMarkup(createElement(Plug, { size: 48 }));
const ALERT_ICON_SVG = renderToStaticMarkup(createElement(TriangleAlert, { size: 48 }));

function showGuestExpiredOverlay(apiBase: string): void {
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

function showSessionTakenOverOverlay(): void {
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

function resolveLimitTitleAndDesc(code: number | undefined, text: string): { title: string; description: string } {
  if (code === 4005 || text === 'trial_expired') {
    return {
      title: 'Trial Expired',
      description: 'Your free trial has ended. Please subscribe to continue using the service.',
    };
  }
  if (code === 4004 || text === 'subscription_suspended') {
    return {
      title: 'Account Suspended',
      description: 'Your account has been suspended due to payment issues. Please update your payment method.',
    };
  }
  if (code === 4003 || text === 'subscription_inactive') {
    return {
      title: 'Subscription Inactive',
      description: 'Your subscription is not active. Please check your billing settings.',
    };
  }
  if (code === 4002 || text === 'oss_limit_reached') {
    return {
      title: 'User Limit Reached',
      description:
        'This instance has reached its maximum user limit (25). Please try again later or contact the administrator.',
    };
  }
  return {
    title: 'Tenant Limit Reached',
    description:
      'Your organization has reached its maximum concurrent user limit. Please upgrade your plan or try again later.',
  };
}

function showLimitErrorOverlay(code: number | undefined, text: string, onRetry: () => void): void {
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

/**
 * Colyseus' `Room.onError` callback is invoked with `(code: number, message?: string)`
 * (see node_modules/@colyseus/sdk/build/Room.d.ts). Captured via `(...ev)`
 * rest args, the elements would be `[number, string?]`. Legacy emitters
 * (close-frame shims, manual triggers) can also forward a full close-event
 * object as the sole element. The union accommodates both shapes.
 */
export type ColyseusErrorPayload = number | string | { code?: number; reason?: string; message?: string };

function extractErrorInfo(ev: readonly ColyseusErrorPayload[]): {
  code: number | undefined;
  reason: string | undefined;
  text: string;
} {
  const first = ev[0];
  if (typeof first === 'number') {
    const message = typeof ev[1] === 'string' ? ev[1] : '';
    return { code: first, reason: message || undefined, text: message };
  }
  if (first && typeof first === 'object') {
    const code = typeof first.code === 'number' ? first.code : undefined;
    const reason = typeof first.reason === 'string' ? first.reason : undefined;
    const msg = typeof first.message === 'string' ? first.message : '';
    const text = reason || msg || '';
    return { code, reason, text };
  }
  return { code: undefined, reason: undefined, text: '' };
}

function classifyConnectError(msg: string): { reason?: string; cooldown?: boolean } {
  const msgLower = String(msg).toLowerCase();
  if (msgLower.includes('insufficient resources')) {
    return { reason: 'Insufficient resources', cooldown: true };
  }
  if (
    msgLower.includes('colyseus_join_timeout') ||
    msgLower.includes('colyseus_state_timeout') ||
    msgLower.includes('livekit_token_timeout') ||
    msgLower.includes('livekit_connect_timeout')
  ) {
    return { reason: 'connect_timeout' };
  }
  return {};
}

function performScheduleReconnect(
  disposed: boolean,
  onReconnect: (() => void) | undefined,
  refs: ConnectionRefs,
  setConnectionStatus: UseWorldRoomArgs['setConnectionStatus'],
): number | undefined {
  if (disposed) return undefined;
  try {
    const { code, reason } = refs.lastCloseInfoRef.current;
    const status: { reconnecting: boolean; lastCode?: number; lastReason?: string } = { reconnecting: true };
    if (code !== undefined) status.lastCode = code;
    if (reason !== undefined) status.lastReason = reason;
    setConnectionStatus?.(status);
  } catch {}
  try {
    window.__wsReconnects = (window.__wsReconnects || 0) + 1;
  } catch {}
  const now = Date.now();
  if (refs.coolDownUntilRef.current > now) {
    // In cooldown (e.g. on 'Insufficient resources'); wait until it expires.
  } else {
    // Exponential backoff.
    const attempt = ++refs.reconnectAttemptsRef.current;
    // Circuit breaker: extend the cooldown after many failed attempts.
    if (attempt >= 8) {
      refs.coolDownUntilRef.current = now + 60_000; // 60s pause.
      refs.reconnectAttemptsRef.current = 0;
    }
  }
  const baseAttempt = Math.max(1, refs.reconnectAttemptsRef.current);
  const delayBase = Math.min(30_000, 1000 * Math.pow(2, baseAttempt - 1) + Math.random() * 500);
  const extra = Math.max(0, refs.coolDownUntilRef.current - now);
  const delay = Math.max(delayBase, extra);
  if (refs.reconnectTimerRef.current) clearTimeout(refs.reconnectTimerRef.current);
  refs.reconnectTimerRef.current = setTimeout(() => {
    refs.reconnectTimerRef.current = null;
    if (onReconnect) onReconnect();
  }, delay);
  return delay;
}

type PerformConnectArgs = {
  apiBase: string;
  me: NonNullable<UseWorldRoomArgs['me']>;
  localPosRef: UseWorldRoomArgs['localPosRef'];
  colyseusRef: UseWorldRoomArgs['colyseusRef'];
  setConnectionStatus: UseWorldRoomArgs['setConnectionStatus'];
  refs: ConnectionRefs;
  scheduleReconnect: (disposed: boolean, onReconnect?: () => void) => number | undefined;
};

async function performConnect(
  disposed: boolean,
  onConnected: (room: WorldRoom) => void,
  args: PerformConnectArgs,
): Promise<WorldRoom | null | { error: unknown; needsReconnect: boolean; delay: number | undefined }> {
  const { apiBase, me, localPosRef, colyseusRef, setConnectionStatus, refs, scheduleReconnect } = args;
  refs.connectingRef.current = true;
  try {
    // The server owns the default spawn; no localStorage spawn injection anymore.
    const positionToUse: { x: number; y: number; direction?: string } | undefined =
      localPosRef.current && typeof localPosRef.current.x === 'number' && typeof localPosRef.current.y === 'number'
        ? { x: localPosRef.current.x, y: localPosRef.current.y }
        : undefined;
    if (positionToUse) {
      logger.debug('[useWorldRoom] Joining with saved position:', positionToUse.x, positionToUse.y);
    }
    const currentMapName = useMapStore.getState().currentMapName;
    const room = await joinWorld(
      apiBase,
      me.id,
      me.name || me.email || me.id,
      positionToUse,
      currentMapName || undefined,
    );
    if (disposed) {
      try {
        void room.leave();
      } catch {}
      return null;
    }
    colyseusRef.current = room;
    refs.reconnectAttemptsRef.current = 0;
    try {
      setConnectionStatus?.({ reconnecting: false });
    } catch {}
    refs.connectingRef.current = false;

    onConnected(room);
    return room;
  } catch (err: unknown) {
    try {
      const errLike = err as { message?: unknown; toString?: () => string } | undefined;
      const msg = (errLike && (typeof errLike.message === 'string' ? errLike.message : errLike.toString?.())) || '';
      const cls = classifyConnectError(msg);
      if (cls.cooldown) {
        refs.coolDownUntilRef.current = Date.now() + 60_000;
      }
      if (cls.reason) {
        refs.lastCloseInfoRef.current = { reason: cls.reason };
        if (cls.reason === 'connect_timeout') {
          logger.warn('[useColyseusConnection] connect timeout', { reason: msg });
        }
      }
    } catch {}
    refs.connectingRef.current = false;
    const delay = scheduleReconnect(disposed);
    return { error: err, needsReconnect: true, delay };
  }
}

type PerformHandleErrorArgs = {
  apiBase: string;
  refs: ConnectionRefs;
  colyseusRef: UseWorldRoomArgs['colyseusRef'];
  scheduleReconnect: (disposed: boolean, onReconnect?: () => void) => number | undefined;
  resetRefsBeforeReconnect: () => void;
};

function performHandleError(
  ev: readonly ColyseusErrorPayload[],
  disposed: boolean,
  onReconnect: () => void,
  args: PerformHandleErrorArgs,
): void {
  const { apiBase, refs, colyseusRef, scheduleReconnect, resetRefsBeforeReconnect } = args;
  try {
    const { code, reason, text } = extractErrorInfo(ev);
    if (text.toLowerCase().includes('insufficient resources')) {
      // Set a cooldown to prevent a flood of session IDs
      refs.coolDownUntilRef.current = Date.now() + 60_000;
    }
    const closeInfo: { code?: number; reason?: string } = {};
    if (code !== undefined) closeInfo.code = code;
    if (reason !== undefined) closeInfo.reason = reason;
    refs.lastCloseInfoRef.current = closeInfo;

    // Handle guest expired - redirect to auth screen
    const isGuestExpired = code === 4006 || text === 'guest_expired';
    if (isGuestExpired) {
      showGuestExpiredOverlay(apiBase);
      colyseusRef.current = null;
      refs.connectingRef.current = false;
      return;
    }

    // Handle session takeover: the old client is kicked when a new client takes over.
    const isSessionTakenOver = code === 4007 || text === 'session_taken_over';
    if (isSessionTakenOver) {
      showSessionTakenOverOverlay();
      colyseusRef.current = null;
      refs.connectingRef.current = false;
      // Do NOT auto-reconnect: the user must click reconnect explicitly.
      return;
    }

    // Handle user limit and billing errors - show UI feedback and don't auto-reconnect
    const isBillingError =
      code === 4003 ||
      code === 4004 ||
      code === 4005 ||
      text === 'subscription_inactive' ||
      text === 'subscription_suspended' ||
      text === 'trial_expired';
    const isLimitError =
      code === 4001 || code === 4002 || text === 'tenant_limit_reached' || text === 'oss_limit_reached';

    if (isBillingError || isLimitError) {
      showLimitErrorOverlay(code, text, onReconnect);
      colyseusRef.current = null;
      refs.connectingRef.current = false;
      // Don't auto-reconnect for limit errors - user must click retry
      return;
    }
  } catch {}
  colyseusRef.current = null;
  refs.connectingRef.current = false;
  resetRefsBeforeReconnect();
  scheduleReconnect(disposed, onReconnect);
}

export function useColyseusConnection(args: UseWorldRoomArgs, connectionRefs: ConnectionRefs) {
  const { lastCloseInfoRef, connectingRef, coolDownUntilRef, hasReceivedFullStateRef } = connectionRefs;
  const { apiBase, me, localPosRef, colyseusRef, remotesRef, colyseusToLivekitMap, setConnectionStatus } = args;

  /**
   * Reset Colyseus-tied refs before reconnect so stale remote-player data from the previous
   * session doesn't leak into the new one. identityToNameMap is intentionally kept as a cache
   * (name→identity lookups are stable across sessions).
   */
  const resetRefsBeforeReconnect = React.useCallback(() => {
    try {
      remotesRef.current = {};
    } catch {}
    try {
      colyseusToLivekitMap.current = {};
    } catch {}
    try {
      hasReceivedFullStateRef.current = false;
    } catch {}
  }, [remotesRef, colyseusToLivekitMap, hasReceivedFullStateRef]);

  const scheduleReconnect = React.useCallback(
    (disposed: boolean, onReconnect?: () => void) => {
      return performScheduleReconnect(disposed, onReconnect, connectionRefs, setConnectionStatus);
    },
    [connectionRefs, setConnectionStatus],
  );

  const connect = React.useCallback(
    async (disposed: boolean, onConnected: (room: WorldRoom) => void) => {
      if (disposed) return null;
      if (connectingRef.current) return null;
      if (!me) return null;

      const now = Date.now();
      if (coolDownUntilRef.current > now) {
        const delay = scheduleReconnect(disposed);
        return { needsReconnect: true, delay };
      }

      return performConnect(disposed, onConnected, {
        apiBase,
        me,
        localPosRef,
        colyseusRef,
        setConnectionStatus,
        refs: connectionRefs,
        scheduleReconnect,
      });
    },
    [
      apiBase,
      me,
      localPosRef,
      colyseusRef,
      connectingRef,
      coolDownUntilRef,
      setConnectionStatus,
      connectionRefs,
      scheduleReconnect,
    ],
  );

  const handleError = React.useCallback(
    (ev: readonly ColyseusErrorPayload[], disposed: boolean, onReconnect: () => void) => {
      performHandleError(ev, disposed, onReconnect, {
        apiBase,
        refs: connectionRefs,
        colyseusRef,
        scheduleReconnect,
        resetRefsBeforeReconnect,
      });
    },
    [apiBase, connectionRefs, colyseusRef, scheduleReconnect, resetRefsBeforeReconnect],
  );

  const handleLeave = React.useCallback(
    (code: number | undefined, disposed: boolean, onReconnect?: () => void) => {
      try {
        const info: { code?: number; reason?: string } = {};
        if (code !== undefined) info.code = code;
        lastCloseInfoRef.current = info;
      } catch {}
      colyseusRef.current = null;
      connectingRef.current = false;
      resetRefsBeforeReconnect();
      scheduleReconnect(disposed, onReconnect);
    },
    [lastCloseInfoRef, colyseusRef, connectingRef, scheduleReconnect, resetRefsBeforeReconnect],
  );

  return {
    connect,
    scheduleReconnect,
    handleError,
    handleLeave,
  };
}
