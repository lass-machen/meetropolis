/**
 * Unit tests for extractErrorInfo, classifyConnectError and
 * performScheduleReconnect.
 *
 * The functions are exported with a "for testing only" annotation; they are
 * not part of the public hook API.
 *
 * The module has top-level side effects (renderToStaticMarkup, lucide icons,
 * i18n) that must be mocked before import so jsdom does not fail on missing
 * DOM globals that Phaser/SVG rendering requires.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const overlayMocks = vi.hoisted(() => ({
  showGuestExpiredOverlay: vi.fn(),
  showAuthExpiredOverlay: vi.fn(),
  showClientTooOldOverlay: vi.fn(),
  showSessionTakenOverOverlay: vi.fn(),
  showLimitErrorOverlay: vi.fn(),
  showTranscriptionConsentOverlay: vi.fn(),
}));

vi.mock('./connectionOverlays', () => overlayMocks);

// Mock react-dom/server to avoid SSR renderer being loaded in jsdom test env.
vi.mock('react-dom/server', () => ({
  renderToStaticMarkup: () => '<svg></svg>',
}));

// Mock lucide-react icons referenced at module top level.
vi.mock('lucide-react', () => ({
  Timer: 'Timer',
  Plug: 'Plug',
  TriangleAlert: 'TriangleAlert',
}));

// Mock i18n so t() calls at render time return empty strings.
vi.mock('../../app/providers/i18n', () => ({
  default: { t: (key: string) => key },
}));

// Mock colyseus join helper (not called in pure-function tests, but required
// to satisfy the import graph).
vi.mock('../../lib/colyseus', () => ({
  deriveTenant: () => 'workspace',
  joinWorld: vi.fn(),
}));

// Mock logger to suppress output during tests.
vi.mock('../../lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock mapStore to prevent Zustand store setup side effects.
vi.mock('../../state/mapStore', () => ({
  useMapStore: { getState: () => ({ currentMapName: null }) },
}));

// Mock the DOM dialog helpers so the give-up path can be asserted without
// rendering overlays.
vi.mock('../handlers/sessionDialogs', () => ({
  showServerRestartDialog: vi.fn(),
  showReconnectFailedDialog: vi.fn(),
}));

import { ServerError } from '@colyseus/sdk';
import { joinWorld } from '../../lib/colyseus';
import {
  extractErrorInfo,
  classifyConnectError,
  performConnect,
  performScheduleReconnect,
  performHandleError,
  performHandleLeave,
  MAX_RECONNECT_ATTEMPTS,
} from './useColyseusConnection';
import { showReconnectFailedDialog } from '../handlers/sessionDialogs';
import type { ConnectionRefs } from '../types';
import type { WorldRoom } from '../../types/colyseus';

// ---------------------------------------------------------------------------
// extractErrorInfo
// ---------------------------------------------------------------------------

describe('extractErrorInfo', () => {
  it('handles tuple shape [code, message]', () => {
    const result = extractErrorInfo([4001, 'reason text']);
    expect(result).toEqual({ code: 4001, reason: 'reason text', text: 'reason text' });
  });

  it('handles tuple shape [code] without message', () => {
    const result = extractErrorInfo([4001]);
    expect(result).toEqual({ code: 4001, reason: undefined, text: '' });
  });

  it('handles object shape with code, reason, and message', () => {
    const result = extractErrorInfo([{ code: 4006, reason: 'limit hit', message: 'oops' }]);
    // reason wins over message for the text field
    expect(result).toEqual({ code: 4006, reason: 'limit hit', text: 'limit hit' });
  });

  it('handles object shape with only message (no reason)', () => {
    const result = extractErrorInfo([{ code: 4003, message: 'subscription_inactive' }]);
    expect(result).toEqual({ code: 4003, reason: undefined, text: 'subscription_inactive' });
  });

  it('handles empty array', () => {
    const result = extractErrorInfo([]);
    expect(result).toEqual({ code: undefined, reason: undefined, text: '' });
  });

  it('handles object shape without reason or message (falls back to empty string)', () => {
    const result = extractErrorInfo([{ code: 4007 }]);
    expect(result).toEqual({ code: 4007, reason: undefined, text: '' });
  });

  it('ignores non-string second element when first is a number', () => {
    // Second arg must be a string; if it is not, text and reason should be empty.
    const result = extractErrorInfo([4002, 42]);
    expect(result).toEqual({ code: 4002, reason: undefined, text: '' });
  });
});

// ---------------------------------------------------------------------------
// classifyConnectError
// ---------------------------------------------------------------------------

describe('classifyConnectError', () => {
  it('classifies Insufficient resources as cooldown', () => {
    expect(classifyConnectError('Insufficient resources')).toEqual({
      reason: 'Insufficient resources',
      cooldown: true,
    });
  });

  it('classifies Insufficient resources case-insensitively', () => {
    expect(classifyConnectError('INSUFFICIENT RESOURCES: no capacity')).toEqual({
      reason: 'Insufficient resources',
      cooldown: true,
    });
  });

  it('classifies colyseus_join_timeout as connect_timeout', () => {
    expect(classifyConnectError('colyseus_join_timeout')).toEqual({ reason: 'connect_timeout' });
  });

  it('classifies colyseus_state_timeout as connect_timeout', () => {
    expect(classifyConnectError('colyseus_state_timeout')).toEqual({ reason: 'connect_timeout' });
  });

  it('classifies livekit_token_timeout as connect_timeout', () => {
    expect(classifyConnectError('livekit_token_timeout')).toEqual({ reason: 'connect_timeout' });
  });

  it('classifies livekit_connect_timeout as connect_timeout', () => {
    expect(classifyConnectError('livekit_connect_timeout')).toEqual({ reason: 'connect_timeout' });
  });

  it('returns empty object for unrecognised messages', () => {
    expect(classifyConnectError('some random network error')).toEqual({});
  });

  it('returns empty object for empty string', () => {
    expect(classifyConnectError('')).toEqual({});
  });

  it('handles mixed-case timeout strings correctly', () => {
    // The implementation lowercases the input before matching.
    expect(classifyConnectError('COLYSEUS_JOIN_TIMEOUT')).toEqual({ reason: 'connect_timeout' });
    expect(classifyConnectError('LiveKit_Connect_Timeout')).toEqual({ reason: 'connect_timeout' });
  });
});

// ---------------------------------------------------------------------------
// performScheduleReconnect
// ---------------------------------------------------------------------------

function makeRefs(): ConnectionRefs {
  return {
    reconnectAttemptsRef: { current: 0 },
    reconnectTimerRef: { current: null },
    lastCloseInfoRef: { current: {} },
    connectingRef: { current: false },
    coolDownUntilRef: { current: 0 },
    hasReceivedFullStateRef: { current: false },
    terminalOverlayRef: { current: false },
  };
}

describe('performScheduleReconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Deterministic delays: jitter contribution becomes zero.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns undefined and schedules nothing when disposed', () => {
    const refs = makeRefs();
    expect(performScheduleReconnect(true, undefined, refs, undefined)).toBeUndefined();
    expect(refs.reconnectTimerRef.current).toBeNull();
  });

  it('grows the delay exponentially across attempts', () => {
    const refs = makeRefs();
    expect(performScheduleReconnect(false, undefined, refs, undefined)).toBe(1_000);
    expect(performScheduleReconnect(false, undefined, refs, undefined)).toBe(2_000);
    expect(performScheduleReconnect(false, undefined, refs, undefined)).toBe(4_000);
  });

  it('caps the delay at 30 seconds', () => {
    const refs = makeRefs();
    refs.reconnectAttemptsRef.current = 9;
    expect(performScheduleReconnect(false, undefined, refs, undefined)).toBe(30_000);
  });

  it('reports the reconnecting status with the last close info', () => {
    const refs = makeRefs();
    refs.lastCloseInfoRef.current = { code: 4001, reason: 'boom' };
    const setStatus = vi.fn();
    performScheduleReconnect(false, undefined, refs, setStatus);
    expect(setStatus).toHaveBeenCalledWith({ reconnecting: true, lastCode: 4001, lastReason: 'boom' });
  });

  it('invokes onReconnect after the computed delay', () => {
    const refs = makeRefs();
    const onReconnect = vi.fn();
    performScheduleReconnect(false, onReconnect, refs, undefined);
    vi.advanceTimersByTime(999);
    expect(onReconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(refs.reconnectTimerRef.current).toBeNull();
  });

  it('applies the circuit-breaker cooldown without resetting the attempt counter', () => {
    const refs = makeRefs();
    refs.reconnectAttemptsRef.current = 7;
    const delay = performScheduleReconnect(false, undefined, refs, undefined);
    expect(refs.reconnectAttemptsRef.current).toBe(8);
    expect(delay).toBe(60_000);
  });

  it('does not consume attempts while a cooldown window is active', () => {
    const refs = makeRefs();
    refs.reconnectAttemptsRef.current = 3;
    refs.coolDownUntilRef.current = Date.now() + 45_000;
    const delay = performScheduleReconnect(false, undefined, refs, undefined);
    expect(refs.reconnectAttemptsRef.current).toBe(3);
    expect(delay).toBe(45_000);
  });

  it('enters the terminal state after the attempt budget is exhausted', () => {
    const refs = makeRefs();
    refs.reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS;
    refs.lastCloseInfoRef.current = { code: 1006 };
    const setStatus = vi.fn();
    const onReconnect = vi.fn();

    const delay = performScheduleReconnect(false, onReconnect, refs, setStatus);

    expect(delay).toBeUndefined();
    expect(refs.reconnectTimerRef.current).toBeNull();
    expect(setStatus).toHaveBeenCalledWith({ reconnecting: false, lastReason: 'reconnect_gave_up', lastCode: 1006 });
    expect(showReconnectFailedDialog).toHaveBeenCalledTimes(1);

    // The explicit retry resets the backoff state and resumes connecting.
    const dialogArgs = vi.mocked(showReconnectFailedDialog).mock.calls[0][0];
    dialogArgs.onRetry();
    expect(refs.reconnectAttemptsRef.current).toBe(0);
    expect(refs.coolDownUntilRef.current).toBe(0);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});

describe('performHandleError transcription consent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  function makeArgs() {
    return {
      apiBase: '/api',
      refs: makeRefs(),
      colyseusRef: { current: null as WorldRoom | null },
      scheduleReconnect: vi.fn(() => undefined),
      resetRefsBeforeReconnect: vi.fn(),
    };
  }

  it('shows the consent gate for code 4008 and reconnects once after acceptance', () => {
    const args = makeArgs();
    const onReconnect = vi.fn();

    performHandleError([4008], false, onReconnect, args);

    expect(overlayMocks.showTranscriptionConsentOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ tenantSlug: 'workspace' }),
    );
    expect(args.scheduleReconnect).not.toHaveBeenCalled();
    const { onAccepted } = overlayMocks.showTranscriptionConsentOverlay.mock.calls[0][0];
    onAccepted();
    onAccepted();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('shows the consent gate for its reason and leaves the world when declined', () => {
    const args = makeArgs();

    performHandleError([4000, 'transcription_consent_required'], false, vi.fn(), args);

    const { onDeclined } = overlayMocks.showTranscriptionConsentOverlay.mock.calls[0][0];
    onDeclined();
    expect(window.location.hash).toBe('#/');
    expect(args.scheduleReconnect).not.toHaveBeenCalled();
  });

  it('routes guest_expired on code 4006 to the guest overlay and not the consent dialog', () => {
    const args = makeArgs();

    performHandleError([4006, 'guest_expired'], false, vi.fn(), args);

    expect(overlayMocks.showGuestExpiredOverlay).toHaveBeenCalledWith('/api');
    expect(overlayMocks.showTranscriptionConsentOverlay).not.toHaveBeenCalled();
    expect(args.scheduleReconnect).not.toHaveBeenCalled();
  });

  it('does not treat a bare code 4006 as a consent requirement', () => {
    const args = makeArgs();

    performHandleError([4006], false, vi.fn(), args);

    expect(overlayMocks.showTranscriptionConsentOverlay).not.toHaveBeenCalled();
  });

  it('reconnects on the unknown gate-unavailable code 4503 without any overlay', () => {
    const args = makeArgs();
    const onReconnect = vi.fn();

    performHandleError([4503, 'transcription_gate_unavailable'], false, onReconnect, args);

    expect(args.scheduleReconnect).toHaveBeenCalledWith(false, onReconnect);
    expect(args.resetRefsBeforeReconnect).toHaveBeenCalledTimes(1);
    for (const overlay of Object.values(overlayMocks)) expect(overlay).not.toHaveBeenCalled();
  });

  it.each([4001, 4002, 4003, 4004, 4005])('keeps limit code %s on the existing overlay', (code) => {
    const args = makeArgs();

    performHandleError([code], false, vi.fn(), args);

    expect(overlayMocks.showLimitErrorOverlay).toHaveBeenCalledTimes(1);
    expect(overlayMocks.showTranscriptionConsentOverlay).not.toHaveBeenCalled();
    expect(args.scheduleReconnect).not.toHaveBeenCalled();
  });
});

describe('performConnect rejected joins', () => {
  function makeConnectArgs() {
    return {
      apiBase: '/api',
      me: { id: 'user-1', name: 'User One' },
      localPosRef: { current: { x: 1, y: 2 } },
      colyseusRef: { current: null as WorldRoom | null },
      dndRef: { current: false },
      setConnectionStatus: vi.fn(),
      refs: makeRefs(),
      scheduleReconnect: vi.fn(() => undefined),
    } as unknown as Parameters<typeof performConnect>[2];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
  });

  it('shows the consent gate for a join rejected with ServerError(4008) and does not reconnect', async () => {
    vi.mocked(joinWorld).mockRejectedValue(new ServerError(4008, 'transcription_consent_required'));
    const args = makeConnectArgs();
    const onReconnect = vi.fn();

    const result = await performConnect(false, vi.fn(), { ...args, onReconnect });

    expect(overlayMocks.showTranscriptionConsentOverlay).toHaveBeenCalledTimes(1);
    expect(args.scheduleReconnect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ needsReconnect: false });
    expect(args.refs.connectingRef.current).toBe(false);
    const { onAccepted } = overlayMocks.showTranscriptionConsentOverlay.mock.calls[0][0];
    onAccepted();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('shows the guest hint for ServerError(4006, guest_expired), not the consent gate', async () => {
    vi.mocked(joinWorld).mockRejectedValue(new ServerError(4006, 'guest_expired'));
    const args = makeConnectArgs();

    await performConnect(false, vi.fn(), args);

    expect(overlayMocks.showGuestExpiredOverlay).toHaveBeenCalledWith('/api');
    expect(overlayMocks.showTranscriptionConsentOverlay).not.toHaveBeenCalled();
    expect(args.scheduleReconnect).not.toHaveBeenCalled();
  });

  it('shows the limit overlay for a join rejected with a billing code', async () => {
    vi.mocked(joinWorld).mockRejectedValue(new ServerError(4005, 'trial_expired'));
    const args = makeConnectArgs();

    await performConnect(false, vi.fn(), args);

    expect(overlayMocks.showLimitErrorOverlay).toHaveBeenCalledTimes(1);
    expect(args.scheduleReconnect).not.toHaveBeenCalled();
  });

  it('reconnects with backoff on the unknown gate-unavailable code 4503 and records its close info', async () => {
    vi.mocked(joinWorld).mockRejectedValue(new ServerError(4503, 'transcription_gate_unavailable'));
    const args = makeConnectArgs();
    const onReconnect = vi.fn();

    const result = await performConnect(false, vi.fn(), { ...args, onReconnect });

    expect(args.scheduleReconnect).toHaveBeenCalledWith(false, onReconnect);
    expect(result).toMatchObject({ needsReconnect: true });
    expect(args.refs.lastCloseInfoRef.current).toEqual({
      code: 4503,
      reason: 'transcription_gate_unavailable',
    });
    for (const overlay of Object.values(overlayMocks)) expect(overlay).not.toHaveBeenCalled();
  });

  it('keeps reconnecting on errors without a code', async () => {
    vi.mocked(joinWorld).mockRejectedValue(new Error('network down'));
    const args = makeConnectArgs();

    await performConnect(false, vi.fn(), args);

    expect(args.scheduleReconnect).toHaveBeenCalledTimes(1);
    for (const overlay of Object.values(overlayMocks)) expect(overlay).not.toHaveBeenCalled();
  });
});

describe('terminal overlay and the room leave event', () => {
  function makeLeaveArgs() {
    return {
      refs: makeRefs(),
      colyseusRef: { current: null as WorldRoom | null },
      scheduleReconnect: vi.fn(() => undefined),
      resetRefsBeforeReconnect: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
  });

  it('still schedules a reconnect on leave when no terminal overlay is active', () => {
    const args = makeLeaveArgs();
    const onReconnect = vi.fn();

    performHandleLeave(1006, false, onReconnect, args);

    expect(args.scheduleReconnect).toHaveBeenCalledWith(false, onReconnect);
    expect(args.resetRefsBeforeReconnect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['transcription consent', [4008, 'transcription_consent_required'], 'showTranscriptionConsentOverlay'],
    ['guest expiry', [4006, 'guest_expired'], 'showGuestExpiredOverlay'],
    ['session takeover', [4007, 'session_taken_over'], 'showSessionTakenOverOverlay'],
  ] as const)('does not reconnect on leave after the %s overlay', (_name, payload, overlay) => {
    const args = { apiBase: '/api', ...makeLeaveArgs() };

    performHandleError([...payload], false, vi.fn(), args);
    expect(overlayMocks[overlay]).toHaveBeenCalledTimes(1);
    expect(args.refs.terminalOverlayRef.current).toBe(true);

    performHandleLeave(payload[0], false, vi.fn(), args);

    expect(args.scheduleReconnect).not.toHaveBeenCalled();
    expect(args.colyseusRef.current).toBeNull();
    expect(args.resetRefsBeforeReconnect).toHaveBeenCalledTimes(1);
  });

  it('clears the flag when the consent dialog is accepted, so a later drop reconnects again', () => {
    const args = { apiBase: '/api', ...makeLeaveArgs() };
    const onReconnect = vi.fn();

    performHandleError([4008], false, onReconnect, args);
    overlayMocks.showTranscriptionConsentOverlay.mock.calls[0][0].onAccepted();

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(args.refs.terminalOverlayRef.current).toBe(false);
    performHandleLeave(1006, false, onReconnect, args);
    expect(args.scheduleReconnect).toHaveBeenCalledTimes(1);
  });

  it('clears the flag when the limit overlay retry is used', () => {
    const args = { apiBase: '/api', ...makeLeaveArgs() };
    const onReconnect = vi.fn();

    performHandleError([4001, 'tenant_limit_reached'], false, onReconnect, args);
    expect(args.refs.terminalOverlayRef.current).toBe(true);
    overlayMocks.showLimitErrorOverlay.mock.calls[0][2]();

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(args.refs.terminalOverlayRef.current).toBe(false);
  });

  it('clears the flag after a successful connect', async () => {
    const refs = makeRefs();
    refs.terminalOverlayRef.current = true;
    const room = { leave: vi.fn() } as unknown as WorldRoom;
    vi.mocked(joinWorld).mockResolvedValue(room);

    await performConnect(false, vi.fn(), {
      apiBase: '/api',
      me: { id: 'user-1', name: 'User One' },
      localPosRef: { current: { x: 1, y: 2 } },
      colyseusRef: { current: null as WorldRoom | null },
      dndRef: { current: false },
      setConnectionStatus: vi.fn(),
      refs,
      scheduleReconnect: vi.fn(() => undefined),
    } as unknown as Parameters<typeof performConnect>[2]);

    expect(refs.terminalOverlayRef.current).toBe(false);
  });
});
