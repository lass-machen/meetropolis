/**
 * Unit tests for routeTerminalConnectionError: the client_update_required
 * kind (code 4426/426 with text 'client_update_required') must render the
 * asset-update variant of the client-too-old overlay, while every previous
 * client_too_old case keeps the default overlay.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const overlayMocks = vi.hoisted(() => ({
  showGuestExpiredOverlay: vi.fn(),
  showAuthExpiredOverlay: vi.fn(),
  showClientTooOldOverlay: vi.fn(),
  showSessionTakenOverOverlay: vi.fn(),
  showLimitErrorOverlay: vi.fn(),
  showTranscriptionConsentOverlay: vi.fn(),
}));

vi.mock('./connectionOverlays', () => overlayMocks);

vi.mock('../../lib/colyseus', () => ({
  deriveTenant: () => 'workspace',
}));

import { routeTerminalConnectionError } from './connectionErrorRouting';
import type { ConnectionErrorRouteContext } from './connectionErrorRouting';

function makeCtx(): ConnectionErrorRouteContext {
  return {
    apiBase: '/api',
    refs: {
      terminalOverlayRef: { current: false },
      connectingRef: { current: false },
    } as unknown as ConnectionErrorRouteContext['refs'],
    colyseusRef: { current: null },
    onReconnect: vi.fn(),
    suspendAv: vi.fn(),
  };
}

describe('routeTerminalConnectionError for client_update_required', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['world join refusal', 4426],
    ['matchmaking refusal', 426],
  ])('routes %s with text client_update_required to the asset-update overlay', (_label, code) => {
    const result = routeTerminalConnectionError({ code, reason: undefined, text: 'client_update_required' }, makeCtx());

    expect(result).toBe(true);
    expect(overlayMocks.showClientTooOldOverlay).toHaveBeenCalledTimes(1);
    expect(overlayMocks.showClientTooOldOverlay).toHaveBeenCalledWith({ assetUpdate: true });
  });

  it.each([
    ['legacy text client_too_old', 'client_too_old'],
    ['bare code without text', ''],
    ['legacy matchmaking text', 'version_too_old'],
  ])('keeps the default overlay for %s', (_label, text) => {
    const result = routeTerminalConnectionError({ code: 4426, reason: undefined, text }, makeCtx());

    expect(result).toBe(true);
    expect(overlayMocks.showClientTooOldOverlay).toHaveBeenCalledTimes(1);
    expect(overlayMocks.showClientTooOldOverlay).toHaveBeenCalledWith();
  });
});
