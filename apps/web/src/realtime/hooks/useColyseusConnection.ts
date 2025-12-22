import React from 'react';
import { joinWorld } from '../../lib/colyseus';
import { logger } from '../../lib/logger';
import type { UseWorldRoomArgs, ConnectionRefs } from '../types';

export function useColyseusConnection(
  args: UseWorldRoomArgs,
  connectionRefs: ConnectionRefs
) {
  const { reconnectAttemptsRef, reconnectTimerRef, lastCloseInfoRef, connectingRef, coolDownUntilRef } = connectionRefs;
  const { apiBase, me, localPosRef, colyseusRef, setConnectionStatus } = args;

  const scheduleReconnect = React.useCallback((disposed: boolean) => {
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
      // This will be set by the caller
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
      const room = await joinWorld(
        apiBase,
        me.id,
        me.name || me.email || me.id,
        positionToUse
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
        if (String(msg).toLowerCase().includes('insufficient resources')) {
          coolDownUntilRef.current = Date.now() + 60_000;
          lastCloseInfoRef.current = { reason: 'Insufficient resources' };
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
    scheduleReconnect(disposed);
  }, [coolDownUntilRef, lastCloseInfoRef, colyseusRef, connectingRef, scheduleReconnect]);

  const handleLeave = React.useCallback((code: number | undefined, disposed: boolean) => {
    try {
      const info: { code?: number; reason?: string } = {};
      if (code !== undefined) info.code = code;
      lastCloseInfoRef.current = info;
    } catch {}
    colyseusRef.current = null;
    connectingRef.current = false;
    scheduleReconnect(disposed);
  }, [lastCloseInfoRef, colyseusRef, connectingRef, scheduleReconnect]);

  return {
    connect,
    scheduleReconnect,
    handleError,
    handleLeave,
  };
}
