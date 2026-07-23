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

import {
  extractErrorInfo,
  classifyConnectError,
  performScheduleReconnect,
  MAX_RECONNECT_ATTEMPTS,
} from './useColyseusConnection';
import { showReconnectFailedDialog } from '../handlers/sessionDialogs';
import type { ConnectionRefs } from '../types';

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
