import React from 'react';
import { joinWorld } from '../../lib/colyseus';
import { getDesktopModule } from '../../lib/desktopLoader';
import { logger } from '../../lib/logger';
import { computeBackoffDelayMs } from '../../lib/backoff';
import { useMapStore } from '../../state/mapStore';
import { showReconnectFailedDialog } from '../handlers/sessionDialogs';
import {
  showGuestExpiredOverlay,
  showAuthExpiredOverlay,
  showClientTooOldOverlay,
  showSessionTakenOverOverlay,
  showLimitErrorOverlay,
} from './connectionOverlays';
import type { UseWorldRoomArgs, ConnectionRefs } from '../types';
import type { WorldRoom } from '../../types/colyseus';

/**
 * H4 hardening: resolve the native (Tauri) auth token so it can be
 * presented explicitly on the Colyseus join (see
 * apps/server/src/rooms/lifecycle/onAuth.ts) - a `tauri://` origin never
 * carries the cross-site auth cookie. Returns undefined in the OSS
 * browser build (no desktop module) and on any older desktop module that
 * predates `getDesktopAuthToken`, in which case the join falls back to
 * cookie-only auth (browser) or fails closed (native, as intended).
 */
async function resolveNativeAuthToken(): Promise<string | undefined> {
  try {
    const desktop = await getDesktopModule();
    return desktop?.getDesktopAuthToken?.() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Colyseus' `Room.onError` callback is invoked with `(code: number, message?: string)`
 * (see node_modules/@colyseus/sdk/build/Room.d.ts). Captured via `(...ev)`
 * rest args, the elements would be `[number, string?]`. Legacy emitters
 * (close-frame shims, manual triggers) can also forward a full close-event
 * object as the sole element. The union accommodates both shapes.
 */
export type ColyseusErrorPayload = number | string | { code?: number; reason?: string; message?: string };

// Exported for unit testing. Not part of the public API.
export function extractErrorInfo(ev: readonly ColyseusErrorPayload[]): {
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

// Exported for unit testing. Not part of the public API.
export function classifyConnectError(msg: string): { reason?: string; cooldown?: boolean } {
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

/** How a terminal server refusal is presented to the user. */
export type RefusalKind = 'auth_rejected' | 'client_too_old' | 'limit';

// Exported for unit testing. Not part of the public API.
// Server refusals that no reconnect can fix, so the user gets an explanation
// instead of an endless retry loop. Anything else (network error, timeout,
// 'Insufficient resources', a lost seat reservation) returns null and is retried.
export function classifyRefusal(code: number | undefined, text: string): RefusalKind | null {
  // H4 hardening: onAuth() rejected the join outright (expired/invalid token,
  // or - for npc-* identities - a bad service token). Re-login is the only way
  // forward; auto-reconnecting would just repeat the rejection forever. See
  // rooms/lifecycle/onAuth.ts AUTH_REJECTED_CODE.
  if (code === 4401 || text === 'unauthorized') return 'auth_rejected';
  // The server judged this build too old: its wire protocol version or its
  // zone-privacy version is below the server's minimum. See
  // rooms/lifecycle/onAuth.ts CLIENT_TOO_OLD_CODE.
  if (code === 4426 || text === 'client_too_old') return 'client_too_old';
  // User limit and billing errors: show UI feedback, the user must click retry.
  const isBillingError =
    code === 4003 ||
    code === 4004 ||
    code === 4005 ||
    text === 'subscription_inactive' ||
    text === 'subscription_suspended' ||
    text === 'trial_expired';
  const isLimitError =
    code === 4001 || code === 4002 || text === 'tenant_limit_reached' || text === 'oss_limit_reached';
  return isBillingError || isLimitError ? 'limit' : null;
}

function showRefusalOverlay(
  kind: RefusalKind,
  code: number | undefined,
  text: string,
  apiBase: string,
  onRetry: () => void,
): void {
  if (kind === 'auth_rejected') showAuthExpiredOverlay(apiBase);
  else if (kind === 'client_too_old') showClientTooOldOverlay();
  else showLimitErrorOverlay(code, text, onRetry);
}

// A refused join never yields a room: the SDK rejects joinOrCreate with an
// error carrying the server's close code and message. Reads both without
// trusting the shape.
function refusalDetails(err: unknown): { code: number | undefined; text: string } {
  if (typeof err !== 'object' || err === null) return { code: undefined, text: '' };
  const code = 'code' in err && typeof err.code === 'number' ? err.code : undefined;
  const text = 'message' in err && typeof err.message === 'string' ? err.message : '';
  return { code, text };
}

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_JITTER_MS = 500;
const CIRCUIT_BREAKER_EVERY_N_ATTEMPTS = 8;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
// Exported for unit testing. Not part of the public API.
export const MAX_RECONNECT_ATTEMPTS = 15;

// Exported for unit testing. Not part of the public API.
export function performScheduleReconnect(
  disposed: boolean,
  onReconnect: (() => void) | undefined,
  refs: ConnectionRefs,
  setConnectionStatus: UseWorldRoomArgs['setConnectionStatus'],
): number | undefined {
  if (disposed) return undefined;
  try {
    window.__wsReconnects = (window.__wsReconnects || 0) + 1;
  } catch {}
  const now = Date.now();
  if (refs.coolDownUntilRef.current > now) {
    // In cooldown (e.g. on 'Insufficient resources'); wait until it expires
    // without consuming additional attempts.
  } else {
    const attempt = ++refs.reconnectAttemptsRef.current;
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      // Terminal state: stop the automatic loop; the user resumes explicitly.
      logger.error('[useColyseusConnection] giving up on automatic reconnect', {
        attempts: MAX_RECONNECT_ATTEMPTS,
      });
      try {
        const { code } = refs.lastCloseInfoRef.current;
        const status: { reconnecting: boolean; lastCode?: number; lastReason?: string } = {
          reconnecting: false,
          lastReason: 'reconnect_gave_up',
        };
        if (code !== undefined) status.lastCode = code;
        setConnectionStatus?.(status);
      } catch {}
      showReconnectFailedDialog({
        onRetry: () => {
          refs.reconnectAttemptsRef.current = 0;
          refs.coolDownUntilRef.current = 0;
          onReconnect?.();
        },
      });
      return undefined;
    }
    // Circuit breaker: insert a long cooldown after several failed attempts.
    // The attempt counter keeps growing so the loop still reaches the
    // terminal state above instead of hammering forever.
    if (attempt % CIRCUIT_BREAKER_EVERY_N_ATTEMPTS === 0) {
      refs.coolDownUntilRef.current = now + CIRCUIT_BREAKER_COOLDOWN_MS;
    }
  }
  try {
    const { code, reason } = refs.lastCloseInfoRef.current;
    const status: { reconnecting: boolean; lastCode?: number; lastReason?: string } = { reconnecting: true };
    if (code !== undefined) status.lastCode = code;
    if (reason !== undefined) status.lastReason = reason;
    setConnectionStatus?.(status);
  } catch {}
  const baseAttempt = Math.max(1, refs.reconnectAttemptsRef.current);
  const delayBase = computeBackoffDelayMs(baseAttempt, {
    baseDelayMs: RECONNECT_BASE_DELAY_MS,
    maxDelayMs: RECONNECT_MAX_DELAY_MS,
    jitterMs: RECONNECT_JITTER_MS,
  });
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
  dndRef: UseWorldRoomArgs['dndRef'];
  setConnectionStatus: UseWorldRoomArgs['setConnectionStatus'];
  refs: ConnectionRefs;
  scheduleReconnect: (disposed: boolean, onReconnect?: () => void) => number | undefined;
  onReconnect?: (() => void) | undefined;
  // Live flag: true once the world app or the effect that started this join
  // has been torn down. `performConnect`'s own `disposed` is only the caller's
  // value from before the join began and cannot see a teardown during it.
  disposedRef?: UseWorldRoomArgs['disposedRef'] | undefined;
};

// Exported for unit testing. Not part of the public API.
export async function performConnect(
  disposed: boolean,
  onConnected: (room: WorldRoom) => void,
  args: PerformConnectArgs,
): Promise<WorldRoom | null | { error: unknown; needsReconnect: boolean; delay: number | undefined }> {
  const { apiBase, me, localPosRef, colyseusRef, dndRef, setConnectionStatus, refs, scheduleReconnect, onReconnect } =
    args;
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
    const authToken = await resolveNativeAuthToken();
    const room = await joinWorld(
      apiBase,
      me.id,
      me.name || me.email || me.id,
      positionToUse,
      currentMapName || undefined,
      authToken,
      dndRef.current === true,
    );
    if (disposed) {
      try {
        void room.leave();
      } catch {}
      return null;
    }
    colyseusRef.current = room;
    // The backoff counter is NOT reset here: it resets only when full_state
    // arrives (see useWorldRoom). A join that opens the socket but never
    // receives state therefore keeps its growing reconnect delay.
    try {
      setConnectionStatus?.({ reconnecting: false });
    } catch {}
    refs.connectingRef.current = false;

    onConnected(room);
    return room;
  } catch (err: unknown) {
    // The room does not exist yet, so handleError (attached to room.onError)
    // never sees a refused join: it arrives here as the rejected promise.
    const { code, text } = refusalDetails(err);
    const refusal = classifyRefusal(code, text);
    if (refusal) {
      // The join can be refused after the component was torn down (logout,
      // leaving the world). The overlays are plain DOM outside React, so one
      // shown now would outlive the session it explains: stop instead, like the
      // retry path below does through scheduleReconnect.
      if (disposed || args.disposedRef?.current === true) {
        logger.debug('[useColyseusConnection] join refused after teardown, no overlay', { code, reason: text });
        refs.connectingRef.current = false;
        return { error: err, needsReconnect: false, delay: undefined };
      }
      logger.warn('[useColyseusConnection] join refused', { code, reason: text });
      const status: { reconnecting: boolean; lastCode?: number; lastReason?: string } = { reconnecting: false };
      const closeInfo: { code?: number; reason?: string } = {};
      if (code !== undefined) {
        status.lastCode = code;
        closeInfo.code = code;
      }
      if (text) {
        status.lastReason = text;
        closeInfo.reason = text;
      }
      refs.lastCloseInfoRef.current = closeInfo;
      try {
        setConnectionStatus?.(status);
      } catch {}
      refs.connectingRef.current = false;
      showRefusalOverlay(refusal, code, text, apiBase, () => onReconnect?.());
      return { error: err, needsReconnect: false, delay: undefined };
    }
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
    const delay = scheduleReconnect(disposed, onReconnect);
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

// Exported for unit testing. Not part of the public API.
export function performHandleError(
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

    const refusal = classifyRefusal(code, text);
    if (refusal) {
      showRefusalOverlay(refusal, code, text, apiBase, onReconnect);
      colyseusRef.current = null;
      refs.connectingRef.current = false;
      // Terminal: no auto-reconnect, the user acts on the overlay.
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
  const {
    apiBase,
    me,
    localPosRef,
    colyseusRef,
    dndRef,
    disposedRef,
    remotesRef,
    colyseusToLivekitMap,
    setConnectionStatus,
  } = args;

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
    async (disposed: boolean, onConnected: (room: WorldRoom) => void, onReconnect?: () => void) => {
      if (disposed) return null;
      if (connectingRef.current) return null;
      if (!me) return null;

      const now = Date.now();
      if (coolDownUntilRef.current > now) {
        const delay = scheduleReconnect(disposed, onReconnect);
        return { needsReconnect: true, delay };
      }

      return performConnect(disposed, onConnected, {
        apiBase,
        me,
        localPosRef,
        colyseusRef,
        dndRef,
        setConnectionStatus,
        refs: connectionRefs,
        scheduleReconnect,
        onReconnect,
        disposedRef,
      });
    },
    [
      apiBase,
      me,
      localPosRef,
      colyseusRef,
      dndRef,
      disposedRef,
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
