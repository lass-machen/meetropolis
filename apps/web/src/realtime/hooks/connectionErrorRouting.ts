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
}

/** Shows the overlay for a terminal error and returns true; false when the
 * error is not terminal and the caller should fall back to a backoff reconnect. */
export function routeTerminalConnectionError(info: ConnectionErrorInfo, ctx: ConnectionErrorRouteContext): boolean {
  const { code, reason, text } = info;
  const { apiBase, onReconnect } = ctx;

  // 4008 is the transcription consent code; 4006 belongs to guest_expired below.
  const isTranscriptionConsentRequired =
    code === 4008 || reason === 'transcription_consent_required' || text === 'transcription_consent_required';
  const isGuestExpired = code === 4006 || text === 'guest_expired';
  // The old client is kicked when a new client takes over; no auto-reconnect,
  // the user must click reconnect explicitly.
  const isSessionTakenOver = code === 4007 || text === 'session_taken_over';
  // H4 hardening: onAuth() rejected the join outright (expired/invalid token, or
  // a bad service token for npc-* identities). Re-login is the only way forward;
  // see rooms/lifecycle/onAuth.ts AUTH_REJECTED_CODE.
  const isAuthRejected = code === 4401 || text === 'unauthorized';
  // H4 hardening: this build's zonePrivacyVersion is below the server's
  // minimum. See rooms/lifecycle/onAuth.ts CLIENT_TOO_OLD_CODE.
  const isClientTooOld = code === 4426 || text === 'client_too_old';
  const isBillingError =
    code === 4003 ||
    code === 4004 ||
    code === 4005 ||
    text === 'subscription_inactive' ||
    text === 'subscription_suspended' ||
    text === 'trial_expired';
  const isLimitError =
    code === 4001 || code === 4002 || text === 'tenant_limit_reached' || text === 'oss_limit_reached';

  if (isTranscriptionConsentRequired) {
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
  } else if (isGuestExpired) {
    showGuestExpiredOverlay(apiBase);
  } else if (isSessionTakenOver) {
    showSessionTakenOverOverlay();
  } else if (isAuthRejected) {
    showAuthExpiredOverlay(apiBase);
  } else if (isClientTooOld) {
    showClientTooOldOverlay();
  } else if (isBillingError || isLimitError) {
    // Limit and billing errors never auto-reconnect: the user must click retry.
    showLimitErrorOverlay(code, text, onReconnect);
  } else {
    return false;
  }

  ctx.colyseusRef.current = null;
  ctx.refs.connectingRef.current = false;
  return true;
}
