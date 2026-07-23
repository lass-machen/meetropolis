// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuthHandlers } from './useAuthHandlers';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// useAuthApi owns the actual fetch/retry plumbing (tested on its own); here we
// stub it so handleRegister/handleLogin exercise only their own post-success
// logic (telemetry + navigation).
const postMock = vi.fn();
const storeDesktopAuthTokenMock = vi.fn(() => Promise.resolve());
vi.mock('./useAuthApi', () => ({
  useAuthApi: () => ({
    post: (...args: unknown[]) => postMock(...args),
    storeDesktopAuthToken: storeDesktopAuthTokenMock,
  }),
}));

// getTelemetryModule is the null-safe optional-telemetry loader (no-op in pure
// OSS builds). Mocked here so we can assert exactly which track method fires,
// with which arguments, for the invite-join path.
const trackSignupMock = vi.fn();
const getTelemetryModuleMock = vi.fn();
vi.mock('../../../../lib/telemetryLoader', () => ({
  getTelemetryModule: () => getTelemetryModuleMock(),
}));

function makeArgs() {
  return {
    apiBase: 'http://api.test',
    setError: vi.fn(),
    setMessage: vi.fn(),
    setMessageType: vi.fn(),
    setView: vi.fn(),
  };
}

describe('useAuthHandlers — handleRegister (invite join)', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    trackSignupMock.mockReset();
    getTelemetryModuleMock.mockReset();
    // Default: telemetry module present (as in a commercial build) so we can
    // assert the call; OSS-build (null) behaviour is covered by its own test.
    getTelemetryModuleMock.mockResolvedValue({ trackSignup: trackSignupMock });
    window.location.hash = '';
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
    window.location.hash = '';
    vi.restoreAllMocks();
  });

  it('fires trackSignup tagged "invite" on a successful invite-code registration, before navigating', async () => {
    postMock.mockResolvedValueOnce({ token: null });

    const { result } = renderHook(() => useAuthHandlers(makeArgs()));
    await result.current.handleRegister(
      { name: 'Jane', email: 'jane@acme.test', password: 'supersecret', invite: 'INV-123' },
      '',
    );

    expect(postMock).toHaveBeenCalledWith('/auth/register', {
      code: 'INV-123',
      name: 'Jane',
      email: 'jane@acme.test',
      password: 'supersecret',
    });
    // Give the fire-and-forget telemetry promise chain a tick to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(getTelemetryModuleMock).toHaveBeenCalledTimes(1);
    expect(trackSignupMock).toHaveBeenCalledWith('invite');
    expect(window.location.hash).toBe('#/app');
  });

  it('falls back to the currentInvite code when no explicit invite is passed in data', async () => {
    postMock.mockResolvedValueOnce({ token: null });

    const { result } = renderHook(() => useAuthHandlers(makeArgs()));
    await result.current.handleRegister({ name: 'Jane', email: 'jane@acme.test', password: 'supersecret' }, 'FROM-URL');

    expect(postMock).toHaveBeenCalledWith('/auth/register', {
      code: 'FROM-URL',
      name: 'Jane',
      email: 'jane@acme.test',
      password: 'supersecret',
    });
  });

  it('stores the desktop auth token when the API returns one', async () => {
    postMock.mockResolvedValueOnce({ token: 'jwt.abc' });

    const { result } = renderHook(() => useAuthHandlers(makeArgs()));
    await result.current.handleRegister({ name: 'Jane', email: 'jane@acme.test', password: 'x', invite: 'INV' }, '');

    expect(storeDesktopAuthTokenMock).toHaveBeenCalledWith('jwt.abc');
  });

  it('is null-safe: a missing telemetry module (pure OSS build) never breaks registration or navigation', async () => {
    getTelemetryModuleMock.mockResolvedValue(null);
    postMock.mockResolvedValueOnce({ token: null });

    const { result } = renderHook(() => useAuthHandlers(makeArgs()));
    await result.current.handleRegister({ name: 'Jane', email: 'jane@acme.test', password: 'x', invite: 'INV' }, '');
    await new Promise((r) => setTimeout(r, 0));

    expect(window.location.hash).toBe('#/app');
  });

  it('sets the error message and does not navigate when registration fails', async () => {
    postMock.mockRejectedValueOnce(new Error('invite_invalid'));
    const args = makeArgs();

    const { result } = renderHook(() => useAuthHandlers(args));
    await result.current.handleRegister({ name: 'Jane', email: 'jane@acme.test', password: 'x', invite: 'BAD' }, '');

    expect(args.setError).toHaveBeenCalledWith('invite_invalid');
    expect(window.location.hash).toBe('');
    expect(trackSignupMock).not.toHaveBeenCalled();
  });
});
