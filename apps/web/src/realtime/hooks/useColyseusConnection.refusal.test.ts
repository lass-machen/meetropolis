/**
 * A refused world join has to end in the matching overlay instead of the
 * reconnect loop. The server refuses in onAuth (4401 re-login, 4426 update
 * needed) and in the join limiter (4001 to 4005), and the SDK delivers every
 * one of them as the rejected joinWorld promise, before a room exists. Only
 * transient failures (network, timeout, lost seat reservation) may reconnect.
 *
 * The overlays are mocked here so the routing can be asserted; their DOM is
 * covered by the browser check of the rollout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../lib/colyseus', () => ({ joinWorld: vi.fn() }));
vi.mock('../../lib/desktopLoader', () => ({ getDesktopModule: vi.fn().mockResolvedValue(null) }));
vi.mock('../../lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../state/mapStore', () => ({
  useMapStore: { getState: () => ({ currentMapName: null }) },
}));
vi.mock('../handlers/sessionDialogs', () => ({
  showServerRestartDialog: vi.fn(),
  showReconnectFailedDialog: vi.fn(),
}));
vi.mock('./connectionOverlays', () => ({
  showGuestExpiredOverlay: vi.fn(),
  showAuthExpiredOverlay: vi.fn(),
  showClientTooOldOverlay: vi.fn(),
  showSessionTakenOverOverlay: vi.fn(),
  showLimitErrorOverlay: vi.fn(),
}));

import { classifyRefusal, performConnect, performHandleError, useColyseusConnection } from './useColyseusConnection';
import { joinWorld } from '../../lib/colyseus';
import {
  showAuthExpiredOverlay,
  showClientTooOldOverlay,
  showLimitErrorOverlay,
  showGuestExpiredOverlay,
  showSessionTakenOverOverlay,
} from './connectionOverlays';
import type { ConnectionRefs, UseWorldRoomArgs } from '../types';

describe('classifyRefusal', () => {
  it.each([
    [4401, ''],
    [undefined, 'unauthorized'],
    [4401, 'missing_world_auth'],
  ])('sends an auth refusal (code %s, text "%s") to re-login', (code, text) => {
    expect(classifyRefusal(code, text)).toBe('auth_rejected');
  });

  it.each([
    [4426, ''],
    [undefined, 'client_too_old'],
  ])('sends a too-old client (code %s, text "%s") to the update overlay', (code, text) => {
    expect(classifyRefusal(code, text)).toBe('client_too_old');
  });

  it.each([
    [4001, 'tenant_limit_reached'],
    [4002, 'oss_limit_reached'],
    [4003, 'subscription_inactive'],
    [4004, 'subscription_suspended'],
    [4005, 'trial_expired'],
    [undefined, 'tenant_limit_reached'],
    [undefined, 'trial_expired'],
  ])('sends a limit or billing refusal (code %s, text "%s") to the limit overlay', (code, text) => {
    expect(classifyRefusal(code, text)).toBe('limit');
  });

  it.each([
    [undefined, ''],
    [undefined, 'Failed to fetch'],
    [1006, ''],
    [4214, 'seat reservation expired'],
    [undefined, 'colyseus_join_timeout'],
    [undefined, 'Insufficient resources'],
    // Post-join codes are handled by handleError on the room, not here.
    [4006, 'guest_expired'],
    [4007, 'session_taken_over'],
  ])('leaves a transient failure (code %s, text "%s") to the reconnect loop', (code, text) => {
    expect(classifyRefusal(code, text)).toBeNull();
  });
});

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

function makeArgs() {
  const refs = makeRefs();
  const scheduleReconnect = vi.fn(() => 1_000);
  const onReconnect = vi.fn();
  const setConnectionStatus = vi.fn();
  const disposedRef = { current: false };
  const args = {
    apiBase: 'https://api.example.test',
    me: { id: 'u1', email: 'u1@example.test', name: 'U One' },
    localPosRef: { current: { id: 'u1' } },
    colyseusRef: { current: null },
    dndRef: { current: false },
    setConnectionStatus,
    refs,
    scheduleReconnect,
    onReconnect,
    disposedRef,
  };
  return { args, refs, scheduleReconnect, onReconnect, setConnectionStatus, disposedRef };
}

/** What the SDK rejects joinOrCreate with: an Error carrying the server's code. */
function serverRefusal(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('performConnect with a refused join', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the re-login overlay for 4401 and does not reconnect', async () => {
    vi.mocked(joinWorld).mockRejectedValue(serverRefusal(4401, 'unauthorized'));
    const { args, refs, scheduleReconnect, setConnectionStatus } = makeArgs();

    const result = await performConnect(false, vi.fn(), args);

    expect(showAuthExpiredOverlay).toHaveBeenCalledWith('https://api.example.test');
    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ needsReconnect: false, delay: undefined });
    expect(refs.connectingRef.current).toBe(false);
    expect(refs.lastCloseInfoRef.current).toEqual({ code: 4401, reason: 'unauthorized' });
    expect(setConnectionStatus).toHaveBeenCalledWith({
      reconnecting: false,
      lastCode: 4401,
      lastReason: 'unauthorized',
    });
  });

  it('shows the update overlay for 4426 and does not reconnect', async () => {
    vi.mocked(joinWorld).mockRejectedValue(serverRefusal(4426, 'client_too_old'));
    const { args, scheduleReconnect } = makeArgs();

    const result = await performConnect(false, vi.fn(), args);

    expect(showClientTooOldOverlay).toHaveBeenCalledTimes(1);
    expect(showAuthExpiredOverlay).not.toHaveBeenCalled();
    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ needsReconnect: false });
  });

  it('recognises a refusal by its text when the code is missing', async () => {
    vi.mocked(joinWorld).mockRejectedValue(new Error('client_too_old'));
    const { args, scheduleReconnect } = makeArgs();

    await performConnect(false, vi.fn(), args);

    expect(showClientTooOldOverlay).toHaveBeenCalledTimes(1);
    expect(scheduleReconnect).not.toHaveBeenCalled();
  });

  it.each([
    [4001, 'tenant_limit_reached'],
    [4002, 'oss_limit_reached'],
    [4003, 'subscription_inactive'],
    [4004, 'subscription_suspended'],
    [4005, 'trial_expired'],
  ])('shows the limit overlay for %s and its retry button reconnects', async (code, message) => {
    vi.mocked(joinWorld).mockRejectedValue(serverRefusal(code, message));
    const { args, scheduleReconnect, onReconnect } = makeArgs();

    const result = await performConnect(false, vi.fn(), args);

    expect(showLimitErrorOverlay).toHaveBeenCalledWith(code, message, expect.any(Function));
    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ needsReconnect: false });
    expect(onReconnect).not.toHaveBeenCalled();
    vi.mocked(showLimitErrorOverlay).mock.calls[0]?.[2]();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});

describe('performConnect when the world is torn down during the join', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function expectNoOverlay(): void {
    expect(showAuthExpiredOverlay).not.toHaveBeenCalled();
    expect(showClientTooOldOverlay).not.toHaveBeenCalled();
    expect(showLimitErrorOverlay).not.toHaveBeenCalled();
    expect(showGuestExpiredOverlay).not.toHaveBeenCalled();
    expect(showSessionTakenOverOverlay).not.toHaveBeenCalled();
  }

  it.each([
    [4401, 'unauthorized'],
    [4426, 'client_too_old'],
    [4001, 'tenant_limit_reached'],
    [4005, 'trial_expired'],
  ])('shows no overlay for the refusal %s that arrives after the teardown', async (code, message) => {
    const { args, refs, scheduleReconnect, setConnectionStatus, disposedRef } = makeArgs();
    // The user leaves the world while the join is still in flight.
    vi.mocked(joinWorld).mockImplementation(() => {
      disposedRef.current = true;
      return Promise.reject(serverRefusal(code, message));
    });

    const result = await performConnect(false, vi.fn(), args);

    expectNoOverlay();
    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(setConnectionStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({ needsReconnect: false, delay: undefined });
    expect(refs.connectingRef.current).toBe(false);
    expect(refs.lastCloseInfoRef.current).toEqual({});
  });

  it('shows no overlay either when the caller already reports the teardown', async () => {
    vi.mocked(joinWorld).mockRejectedValue(serverRefusal(4426, 'client_too_old'));
    const { args, scheduleReconnect } = makeArgs();

    const result = await performConnect(true, vi.fn(), args);

    expectNoOverlay();
    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ needsReconnect: false });
  });

  it('gets the live flag of the world args through the hook, not a copy of it', async () => {
    const disposedRef = { current: false };
    const worldArgs = {
      apiBase: 'https://api.example.test',
      me: { id: 'u1', email: 'u1@example.test', name: 'U One' },
      localPosRef: { current: { id: 'u1' } },
      colyseusRef: { current: null },
      dndRef: { current: false },
      disposedRef,
      remotesRef: { current: {} },
      colyseusToLivekitMap: { current: {} },
      setConnectionStatus: vi.fn(),
    } as unknown as UseWorldRoomArgs;
    vi.mocked(joinWorld).mockImplementation(() => {
      disposedRef.current = true;
      return Promise.reject(serverRefusal(4401, 'unauthorized'));
    });
    const { result } = renderHook(() => useColyseusConnection(worldArgs, makeRefs()));

    await result.current.connect(false, vi.fn(), vi.fn());

    expectNoOverlay();
  });

  it('still shows the overlay for the same refusal while the world is alive', async () => {
    vi.mocked(joinWorld).mockRejectedValue(serverRefusal(4426, 'client_too_old'));
    const { args, disposedRef } = makeArgs();
    expect(disposedRef.current).toBe(false);

    await performConnect(false, vi.fn(), args);

    expect(showClientTooOldOverlay).toHaveBeenCalledTimes(1);
  });
});

describe('performConnect with a transient failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['a network error', new TypeError('Failed to fetch')],
    ['a lost seat reservation', serverRefusal(4214, 'seat reservation expired')],
    ['a connect timeout', new Error('colyseus_join_timeout')],
    ['a resource shortage', new Error('Insufficient resources')],
    ['a rejection that is no Error', 'boom'],
  ])('keeps reconnecting after %s', async (_label, failure) => {
    vi.mocked(joinWorld).mockRejectedValue(failure);
    const { args, scheduleReconnect, setConnectionStatus } = makeArgs();

    const result = await performConnect(false, vi.fn(), args);

    expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ needsReconnect: true, delay: 1_000 });
    expect(showAuthExpiredOverlay).not.toHaveBeenCalled();
    expect(showClientTooOldOverlay).not.toHaveBeenCalled();
    expect(showLimitErrorOverlay).not.toHaveBeenCalled();
    expect(showGuestExpiredOverlay).not.toHaveBeenCalled();
    expect(showSessionTakenOverOverlay).not.toHaveBeenCalled();
    expect(setConnectionStatus).not.toHaveBeenCalled();
  });
});

describe('performHandleError on an established room', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function handle(ev: Parameters<typeof performHandleError>[0]) {
    const { args, refs, scheduleReconnect, onReconnect } = makeArgs();
    const resetRefsBeforeReconnect = vi.fn();
    const colyseusRef = { current: null };
    performHandleError(ev, false, onReconnect, {
      apiBase: args.apiBase,
      refs,
      colyseusRef,
      scheduleReconnect,
      resetRefsBeforeReconnect,
    });
    return { scheduleReconnect, resetRefsBeforeReconnect, onReconnect, refs };
  }

  it.each([
    ['4401 re-login', [4401, 'unauthorized'] as const, showAuthExpiredOverlay],
    ['4426 update', [4426, 'client_too_old'] as const, showClientTooOldOverlay],
    ['4001 limit', [4001, 'tenant_limit_reached'] as const, showLimitErrorOverlay],
    ['4005 billing', [4005, 'trial_expired'] as const, showLimitErrorOverlay],
    ['4006 guest expired', [4006, 'guest_expired'] as const, showGuestExpiredOverlay],
    ['4007 takeover', [4007, 'session_taken_over'] as const, showSessionTakenOverOverlay],
  ])('shows the %s overlay and does not reconnect', (_label, ev, overlay) => {
    const { scheduleReconnect } = handle(ev);
    expect(overlay).toHaveBeenCalledTimes(1);
    expect(scheduleReconnect).not.toHaveBeenCalled();
  });

  it('reconnects after an error that no overlay explains', () => {
    const { scheduleReconnect, resetRefsBeforeReconnect, onReconnect } = handle([1006, 'closed']);
    expect(scheduleReconnect).toHaveBeenCalledWith(false, onReconnect);
    expect(resetRefsBeforeReconnect).toHaveBeenCalledTimes(1);
    expect(showAuthExpiredOverlay).not.toHaveBeenCalled();
    expect(showClientTooOldOverlay).not.toHaveBeenCalled();
    expect(showLimitErrorOverlay).not.toHaveBeenCalled();
  });
});
