import React from 'react';
import { joinWorld } from '../../lib/colyseus';
import { logger } from '../../lib/logger';
import { useMapStore } from '../../state/mapStore';
import type { UseWorldRoomArgs, ConnectionRefs } from '../types';
import i18n from '../../app/providers/i18n';

export function useColyseusConnection(
  args: UseWorldRoomArgs,
  connectionRefs: ConnectionRefs
) {
  const { reconnectAttemptsRef, reconnectTimerRef, lastCloseInfoRef, connectingRef, coolDownUntilRef, hasReceivedFullStateRef } = connectionRefs;
  const { apiBase, me, localPosRef, colyseusRef, remotesRef, colyseusToLivekitMap, setConnectionStatus } = args;

  /**
   * Reset Colyseus-tied refs before reconnect so stale remote-player data from the previous
   * session doesn't leak into the new one. identityToNameMap is intentionally kept as a cache
   * (name→identity lookups are stable across sessions).
   */
  const resetRefsBeforeReconnect = React.useCallback(() => {
    try { remotesRef.current = {}; } catch {}
    try { colyseusToLivekitMap.current = {}; } catch {}
    try { hasReceivedFullStateRef.current = false; } catch {}
  }, [remotesRef, colyseusToLivekitMap, hasReceivedFullStateRef]);

  const scheduleReconnect = React.useCallback((disposed: boolean, onReconnect?: () => void) => {
    if (disposed) return;
    try {
      const { code, reason } = lastCloseInfoRef.current;
      const status: { reconnecting: boolean; lastCode?: number; lastReason?: string } = { reconnecting: true };
      if (code !== undefined) status.lastCode = code;
      if (reason !== undefined) status.lastReason = reason;
      setConnectionStatus?.(status);
    } catch {}
    try { (window as any).__wsReconnects = ((window as any).__wsReconnects || 0) + 1; } catch {}
    const now = Date.now();
    if (coolDownUntilRef.current > now) {
      // In Cooldown (z. B. bei 'Insufficient resources') – warte bis Ablauf.
    } else {
      // Exponentieller Backoff
      const attempt = ++reconnectAttemptsRef.current;
      // Circuit breaker: nach vielen Fehlversuchen längeren Cooldown setzen
      if (attempt >= 8) {
        coolDownUntilRef.current = now + 60_000; // 60s Pause
        reconnectAttemptsRef.current = 0;
      }
    }
    const baseAttempt = Math.max(1, reconnectAttemptsRef.current);
    const delayBase = Math.min(30_000, 1000 * Math.pow(2, baseAttempt - 1) + Math.random() * 500);
    const extra = Math.max(0, coolDownUntilRef.current - now);
    const delay = Math.max(delayBase, extra);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (onReconnect) onReconnect();
    }, delay);
    return delay;
  }, [reconnectAttemptsRef, reconnectTimerRef, lastCloseInfoRef, connectingRef, coolDownUntilRef, setConnectionStatus]);

  const connect = React.useCallback(async (
    disposed: boolean,
    onConnected: (room: any) => void
  ) => {
    if (disposed) return null;
    if (connectingRef.current) return null;
    if (!me) return null;

    const now = Date.now();
    if (coolDownUntilRef.current > now) {
      // Noch im Cooldown – später erneut versuchen
      const delay = scheduleReconnect(disposed);
      return { needsReconnect: true, delay };
    }

    connectingRef.current = true;
    try {
      // Server entscheidet über Default-Spawn: keine LocalStorage-Spawninjektion mehr
      const positionToUse: { x: number; y: number; direction?: string } | undefined =
        localPosRef.current && typeof localPosRef.current.x === 'number' && typeof localPosRef.current.y === 'number'
          ? { x: localPosRef.current.x, y: localPosRef.current.y }
          : undefined;
      // Position wird beim Join an Server gesendet
      if (positionToUse) {
        logger.debug('[useWorldRoom] Joining with saved position:', positionToUse.x, positionToUse.y);
      }
      const currentMapName = useMapStore.getState().currentMapName;
      const room = await joinWorld(
        apiBase,
        me.id,
        me.name || me.email || me.id,
        positionToUse,
        currentMapName || undefined
      );
      if (disposed) { try { room.leave(); } catch {} return null; }
      colyseusRef.current = room;
      reconnectAttemptsRef.current = 0;
      try { setConnectionStatus?.({ reconnecting: false }); } catch {}
      connectingRef.current = false;

      onConnected(room);
      return room;
    } catch (err: any) {
      try {
        const msg = (err && (err.message || err.toString?.())) || '';
        const msgLower = String(msg).toLowerCase();
        if (msgLower.includes('insufficient resources')) {
          coolDownUntilRef.current = Date.now() + 60_000;
          lastCloseInfoRef.current = { reason: 'Insufficient resources' };
        } else if (
          msgLower.includes('colyseus_join_timeout') ||
          msgLower.includes('colyseus_state_timeout') ||
          msgLower.includes('livekit_token_timeout') ||
          msgLower.includes('livekit_connect_timeout')
        ) {
          lastCloseInfoRef.current = { reason: 'connect_timeout' };
          logger.warn('[useColyseusConnection] connect timeout', { reason: msg });
        }
      } catch {}
      connectingRef.current = false;
      const delay = scheduleReconnect(disposed);
      return { error: err, needsReconnect: true, delay };
    }
  }, [apiBase, me, localPosRef, colyseusRef, reconnectAttemptsRef, connectingRef, coolDownUntilRef, lastCloseInfoRef, setConnectionStatus, scheduleReconnect]);

  const handleError = React.useCallback((ev: any[], disposed: boolean, onReconnect: () => void) => {
    try {
      const code = (ev && ev[0] && typeof ev[0].code === 'number') ? ev[0].code : undefined;
      const reason = (ev && ev[0] && typeof ev[0].reason === 'string') ? ev[0].reason : undefined;
      // Manche Browser-Stacks liefern nur Message-Strings
      const msg = (ev && ev[0] && (ev[0].message || ev[0].toString?.())) || '';
      const text = String(reason || msg || '');
      if (text.toLowerCase().includes('insufficient resources')) {
        // Setze Cooldown um Session-ID-Flut zu verhindern
        coolDownUntilRef.current = Date.now() + 60_000;
      }
      lastCloseInfoRef.current = { code, reason };

      // Handle guest expired - redirect to auth screen
      const isGuestExpired = code === 4006 || text === 'guest_expired';
      if (isGuestExpired) {
        try {
          const host = document.createElement('div');
          host.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;';
          host.innerHTML = `
            <div style="min-width:320px;max-width:480px;padding:24px;border-radius:12px;border:1px solid rgba(239,68,68,0.5);background:rgba(239,68,68,0.15);backdrop-filter:blur(8px);color:var(--fg,#fff);box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;">
              <div style="font-size:48px;margin-bottom:12px;">⏱️</div>
              <div style="font-weight:700;font-size:18px;margin-bottom:8px;">Gast-Zugang abgelaufen</div>
              <div style="font-size:14px;color:var(--fg-subtle,#ccc);margin-bottom:16px;">Dein Gast-Zugang ist abgelaufen. Bitte wende dich an den Administrator.</div>
              <button data-guest-expired-ok style="padding:10px 20px;border-radius:8px;border:none;background:var(--accent,#3b82f6);color:white;cursor:pointer;font-weight:600;">Zum Login</button>
            </div>`;
          document.body.appendChild(host);
          host.querySelector('[data-guest-expired-ok]')?.addEventListener('click', () => {
            try { host.remove(); } catch {}
            try {
              fetch(apiBase + '/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => {
                window.location.hash = '#/app';
                window.location.reload();
              });
            } catch { window.location.reload(); }
          }, { once: true } as any);
        } catch {}
        colyseusRef.current = null;
        connectingRef.current = false;
        return;
      }

      // Handle session taken over — old client gets kicked when new client takes over
      const isSessionTakenOver = code === 4007 || text === 'session_taken_over';
      if (isSessionTakenOver) {
        try {
          const host = document.createElement('div');
          host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
          host.innerHTML = `
            <div style="min-width:320px;max-width:480px;padding:24px;border-radius:12px;border:1px solid rgba(234,88,12,0.5);background:rgba(30,41,59,0.95);backdrop-filter:blur(8px);color:#fff;box-shadow:0 8px 32px rgba(0,0,0,0.4);text-align:center;">
              <div style="font-size:48px;margin-bottom:12px;">🔌</div>
              <div style="font-weight:700;font-size:18px;margin-bottom:8px;">${i18n.t('sessionConflict.takenOver.title')}</div>
              <div style="font-size:14px;color:#94a3b8;margin-bottom:20px;">${i18n.t('sessionConflict.takenOver.description')}</div>
              <button data-session-reload style="padding:10px 20px;border-radius:8px;border:none;background:#3b82f6;color:white;cursor:pointer;font-weight:600;font-size:14px;">${i18n.t('sessionConflict.takenOver.reconnect')}</button>
            </div>`;
          document.body.appendChild(host);
          host.querySelector('[data-session-reload]')?.addEventListener('click', () => {
            try { host.remove(); } catch {}
            window.location.reload();
          }, { once: true });
        } catch {}
        colyseusRef.current = null;
        connectingRef.current = false;
        // Do NOT auto-reconnect — user must explicitly click reconnect
        return;
      }

      // Handle user limit and billing errors - show UI feedback and don't auto-reconnect
      const isBillingError = code === 4003 || code === 4004 || code === 4005 ||
        text === 'subscription_inactive' || text === 'subscription_suspended' || text === 'trial_expired';
      const isLimitError = code === 4001 || code === 4002 || text === 'tenant_limit_reached' || text === 'oss_limit_reached';

      if (isBillingError || isLimitError) {
        let title = '';
        let description = '';

        if (code === 4005 || text === 'trial_expired') {
          title = 'Trial Expired';
          description = 'Your free trial has ended. Please subscribe to continue using the service.';
        } else if (code === 4004 || text === 'subscription_suspended') {
          title = 'Account Suspended';
          description = 'Your account has been suspended due to payment issues. Please update your payment method.';
        } else if (code === 4003 || text === 'subscription_inactive') {
          title = 'Subscription Inactive';
          description = 'Your subscription is not active. Please check your billing settings.';
        } else if (code === 4002 || text === 'oss_limit_reached') {
          title = 'User Limit Reached';
          description = 'This instance has reached its maximum user limit (25). Please try again later or contact the administrator.';
        } else {
          title = 'Tenant Limit Reached';
          description = 'Your organization has reached its maximum concurrent user limit. Please upgrade your plan or try again later.';
        }

        try {
          const host = document.createElement('div');
          host.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;';
          host.innerHTML = `
            <div style="min-width:320px;max-width:480px;padding:24px;border-radius:12px;border:1px solid rgba(234,88,12,0.5);background:rgba(234,88,12,0.15);backdrop-filter:blur(8px);color:var(--fg,#fff);box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;">
              <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
              <div style="font-weight:700;font-size:18px;margin-bottom:8px;">${title}</div>
              <div style="font-size:14px;color:var(--fg-subtle,#ccc);margin-bottom:16px;">${description}</div>
              <button data-limit-retry style="padding:10px 20px;border-radius:8px;border:none;background:var(--accent,#3b82f6);color:white;cursor:pointer;font-weight:600;">Retry</button>
            </div>`;
          document.body.appendChild(host);
          const retry = () => { try { host.remove(); } catch {} onReconnect(); };
          host.querySelector('[data-limit-retry]')?.addEventListener('click', retry, { once: true } as any);
        } catch {}

        colyseusRef.current = null;
        connectingRef.current = false;
        // Don't auto-reconnect for limit errors - user must click retry
        return;
      }
    } catch {}
    colyseusRef.current = null;
    connectingRef.current = false;
    resetRefsBeforeReconnect();
    scheduleReconnect(disposed, onReconnect);
  }, [apiBase, coolDownUntilRef, lastCloseInfoRef, colyseusRef, connectingRef, scheduleReconnect, resetRefsBeforeReconnect]);

  const handleLeave = React.useCallback((code: number | undefined, disposed: boolean, onReconnect?: () => void) => {
    try {
      const info: { code?: number; reason?: string } = {};
      if (code !== undefined) info.code = code;
      lastCloseInfoRef.current = info;
    } catch {}
    colyseusRef.current = null;
    connectingRef.current = false;
    resetRefsBeforeReconnect();
    scheduleReconnect(disposed, onReconnect);
  }, [lastCloseInfoRef, colyseusRef, connectingRef, scheduleReconnect, resetRefsBeforeReconnect]);

  return {
    connect,
    scheduleReconnect,
    handleError,
    handleLeave,
  };
}
