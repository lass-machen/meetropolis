/**
 * Maps terminal Colyseus error codes to their user-facing overlay.
 *
 * Shared by both failure paths of a world connection: errors raised on an
 * established room (`room.onError`) and joins the server rejects, which the
 * SDK reports as a rejected `joinOrCreate` carrying a `ServerError(code)`.
 * Extracted from useColyseusConnection.ts (LoC budget).
 */
import { deriveTenant } from '../../lib/colyseus';
import type { UseWorldRoomArgs, ConnectionRefs } from '../types';
import {
  showGuestExpiredOverlay,
  showAuthExpiredOverlay,
  showClientTooOldOverlay,
  showSessionTakenOverOverlay,
  showLimitErrorOverlay,
  showTranscriptionConsentOverlay,
} from './connectionOverlays';

export interface ConnectionErrorInfo {
  code: number | undefined;
  reason: string | undefined;
  text: string;
}

export interface ConnectionErrorRouteContext {
  apiBase: string;
  refs: ConnectionRefs;
  colyseusRef: UseWorldRoomArgs['colyseusRef'];
  onReconnect: () => void;
  // Leaves AV before an overlay takes the user out of the world.
  suspendAv?: (() => void) | undefined;
}

type TerminalErrorKind =
  'consent' | 'guest_expired' | 'session_taken_over' | 'auth_rejected' | 'client_too_old' | 'limit';

/** Classifies a terminal error by the overlay it needs; null when the error is
 * not terminal. The order is the precedence when several signals match. */
function classifyTerminalError({ code, reason, text }: ConnectionErrorInfo): TerminalErrorKind | null {
  // 4008 is the transcription consent code; 4006 belongs to guest_expired below.
  if (code === 4008 || reason === 'transcription_consent_required' || text === 'transcription_consent_required') {
    return 'consent';
  }
  if (code === 4006 || text === 'guest_expired') return 'guest_expired';
  // The old client is kicked when a new client takes over; no auto-reconnect,
  // the user must click reconnect explicitly.
  if (code === 4007 || text === 'session_taken_over') return 'session_taken_over';
  // H4 hardening: onAuth() rejected the join outright (expired/invalid token, or
  // a bad service token for npc-* identities). Re-login is the only way forward;
  // see rooms/lifecycle/onAuth.ts AUTH_REJECTED_CODE.
  if (code === 4401 || text === 'unauthorized') return 'auth_rejected';
  // H4 hardening: this build's zonePrivacyVersion is below the server's
  // minimum. See rooms/lifecycle/onAuth.ts CLIENT_TOO_OLD_CODE.
  if (code === 4426 || text === 'client_too_old') return 'client_too_old';
  // Colyseus itself closes clients with 4001 (SERVER_SHUTDOWN), 4002 (WITH_ERROR)
  // and 4003 (FAILED_TO_RECONNECT), e.g. on a graceful shutdown during a deploy.
  // For those codes only the server text identifies a limit or billing error;
  // a bare code is an unknown error and reconnects with backoff. 4004 and 4005
  // do not collide with a Colyseus close code, so the code alone suffices.
  const isBillingError =
    code === 4004 ||
    code === 4005 ||
    text === 'subscription_inactive' ||
    text === 'subscription_suspended' ||
    text === 'trial_expired';
  const isLimitError = text === 'tenant_limit_reached' || text === 'oss_limit_reached';
  return isBillingError || isLimitError ? 'limit' : null;
}

function showTerminalOverlay(
  kind: TerminalErrorKind,
  { code, text }: ConnectionErrorInfo,
  apiBase: string,
  onReconnect: () => void,
): void {
  switch (kind) {
    case 'consent': {
      let handled = false;
      showTranscriptionConsentOverlay({
        tenantSlug: deriveTenant(),
        onAccepted: () => {
          if (handled) return;
          handled = true;
          onReconnect();
        },
        onDeclined: () => {
          if (handled) return;
          handled = true;
          window.location.hash = '#/';
        },
      });
      return;
    }
    case 'guest_expired':
      showGuestExpiredOverlay(apiBase);
      return;
    case 'session_taken_over':
      showSessionTakenOverOverlay();
      return;
    case 'auth_rejected':
      showAuthExpiredOverlay(apiBase);
      return;
    case 'client_too_old':
      showClientTooOldOverlay();
      return;
    case 'limit':
      // Limit and billing errors never auto-reconnect: the user must click retry.
      showLimitErrorOverlay(code, text, onReconnect);
      return;
  }
}

/** Shows the overlay for a terminal error and returns true; false when the
 * error is not terminal and the caller should fall back to a backoff reconnect. */
export function routeTerminalConnectionError(info: ConnectionErrorInfo, ctx: ConnectionErrorRouteContext): boolean {
  const kind = classifyTerminalError(info);
  if (!kind) return false;
  // A user out of the world must neither publish nor subscribe while the
  // overlay waits for an answer; the next accepted join brings AV back.
  ctx.suspendAv?.();

  // The user's explicit choice ends the terminal state before reconnecting.
  showTerminalOverlay(kind, info, ctx.apiBase, () => {
    ctx.refs.terminalOverlayRef.current = false;
    ctx.onReconnect();
  });

  ctx.colyseusRef.current = null;
  ctx.refs.connectingRef.current = false;
  // The room's own leave event follows its error event; it must not reconnect
  // behind the overlay (see handleLeave).
  ctx.refs.terminalOverlayRef.current = true;
  return true;
}
