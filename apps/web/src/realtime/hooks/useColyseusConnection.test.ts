/**
 * Unit tests for extractErrorInfo and classifyConnectError.
 *
 * Both functions are exported with a "for testing only" annotation; they are
 * not part of the public hook API.
 *
 * The module has top-level side effects (renderToStaticMarkup, lucide icons,
 * i18n) that must be mocked before import so jsdom does not fail on missing
 * DOM globals that Phaser/SVG rendering requires.
 */

import { describe, it, expect, vi } from 'vitest';

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

import { extractErrorInfo, classifyConnectError } from './useColyseusConnection';

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
