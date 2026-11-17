// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { VerificationPendingView } from './VerificationPendingView';
import { PENDING_INVITE_KEY } from '../../../lib/pendingInvite';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (k: string, vars?: Record<string, string | number>) => (vars ? `${k} ${Object.values(vars).join(' ')}` : k),
    }),
  };
});

const API_BASE = 'http://api.test';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function meBody(emailVerified: boolean) {
  return { id: 'user-1', email: 'user@example.test', emailVerified };
}

/** Transport boundary only: controlled client fetch answers. No product mocks. */
let fetchMock: ReturnType<typeof vi.fn>;
let statusResponse: Response | (() => Response | Promise<Response>);
let meQueue: Array<Response | (() => Response | Promise<Response>)>;

function callsEndingWith(suffix: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix));
}

function stubFetch() {
  meQueue = [];
  statusResponse = jsonResponse(200, { status: 'pending' });
  fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u.endsWith('/auth/verify/status')) {
      return Promise.resolve(typeof statusResponse === 'function' ? statusResponse() : statusResponse);
    }
    if (u.endsWith('/auth/me')) {
      const next = meQueue.shift();
      if (!next) {
        return Promise.reject(new Error(`unexpected /auth/me with empty queue: ${u}`));
      }
      return Promise.resolve(typeof next === 'function' ? next() : next);
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const originalLocation = window.location;
let visibilityStateValue = 'visible';
const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');

function setVisibilityState(value: 'visible' | 'hidden') {
  visibilityStateValue = value;
}

function fireFocus() {
  window.dispatchEvent(new Event('focus'));
}

function fireVisibilityVisible() {
  setVisibilityState('visible');
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('VerificationPendingView refetch on return', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    meQueue = [];
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, hash: '#/verify-pending' },
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityStateValue,
    });
    setVisibilityState('visible');
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    if (originalVisibilityDescriptor) {
      Object.defineProperty(Document.prototype, 'visibilityState', originalVisibilityDescriptor);
    } else {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
    }
    setVisibilityState('visible');
  });

  it('refetches /auth/me on focus and on visibilitychange when visible', async () => {
    render(<VerificationPendingView apiBase={API_BASE} />);

    await waitFor(() => expect(callsEndingWith('/auth/verify/status')).toHaveLength(1));
    expect(callsEndingWith('/auth/me')).toHaveLength(0);

    meQueue.push(jsonResponse(200, meBody(false)));
    act(() => {
      fireFocus();
    });
    await waitFor(() => expect(callsEndingWith('/auth/me')).toHaveLength(1));
    const [[meUrl, meInit]] = callsEndingWith('/auth/me');
    expect(String(meUrl)).toBe(`${API_BASE}/auth/me`);
    expect(meInit).toMatchObject({ credentials: 'include' });
    expect(meInit).toHaveProperty('signal');

    meQueue.push(jsonResponse(200, meBody(false)));
    act(() => {
      fireVisibilityVisible();
    });
    await waitFor(() => expect(callsEndingWith('/auth/me')).toHaveLength(2));
    expect(callsEndingWith('/auth/verify/status')).toHaveLength(1);
    expect(window.location.hash).toBe('#/verify-pending');
  });

  it('keeps the pending screen when /auth/me reports an unverified mailbox', async () => {
    sessionStorage.setItem(PENDING_INVITE_KEY, 'MEET-KEEP-1');
    render(<VerificationPendingView apiBase={API_BASE} />);
    await waitFor(() => expect(callsEndingWith('/auth/verify/status')).toHaveLength(1));

    meQueue.push(jsonResponse(200, meBody(false)));
    act(() => {
      fireFocus();
    });
    await waitFor(() => expect(callsEndingWith('/auth/me')).toHaveLength(1));
    // Flush the real fetch→json→hash path; do not sleep or reimplement refetch.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.location.hash).toBe('#/verify-pending');
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe('MEET-KEEP-1');
    expect(callsEndingWith('/auth/verify/status')).toHaveLength(1);
  });

  it('navigates to #/app when a later /auth/me reports emailVerified true', async () => {
    sessionStorage.setItem(PENDING_INVITE_KEY, 'MEET-CLEAR-1');
    render(<VerificationPendingView apiBase={API_BASE} />);
    await waitFor(() => expect(callsEndingWith('/auth/verify/status')).toHaveLength(1));

    meQueue.push(jsonResponse(200, meBody(false)));
    act(() => {
      fireFocus();
    });
    await waitFor(() => expect(callsEndingWith('/auth/me')).toHaveLength(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.location.hash).toBe('#/verify-pending');

    meQueue.push(jsonResponse(200, meBody(true)));
    act(() => {
      fireVisibilityVisible();
    });
    await waitFor(() => expect(callsEndingWith('/auth/me')).toHaveLength(2));
    await waitFor(() => expect(window.location.hash).toBe('#/app'));
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
    expect(callsEndingWith('/auth/verify/status')).toHaveLength(1);
  });

  it('coalesces focus and visibility while an /auth/me probe is still in flight', async () => {
    render(<VerificationPendingView apiBase={API_BASE} />);
    await waitFor(() => expect(callsEndingWith('/auth/verify/status')).toHaveLength(1));

    const me = deferred<Response>();
    meQueue.push(() => me.promise);

    act(() => {
      fireFocus();
    });
    await waitFor(() => expect(callsEndingWith('/auth/me')).toHaveLength(1));

    act(() => {
      fireVisibilityVisible();
      fireFocus();
    });
    expect(callsEndingWith('/auth/me')).toHaveLength(1);

    await act(async () => {
      me.resolve(jsonResponse(200, meBody(false)));
      await me.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(callsEndingWith('/auth/me')).toHaveLength(1);
    expect(window.location.hash).toBe('#/verify-pending');
    expect(callsEndingWith('/auth/verify/status')).toHaveLength(1);
  });
});
