import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { WorldApp } from './WorldApp';

/**
 * The desktop client only leaves its 340px window for the login page because
 * MiniModeWorldSignal mounts BEHIND the auth gate — that single placement is what
 * makes "start at normal size until the session is known" true. Mounting the
 * signal in the loading branch as well passes typecheck, eslint and every other
 * test, and puts the client back into a 340px window while /auth/me is pending
 * (with a dead network: for the whole retry ramp). So the gate is asserted here.
 */
const scenario = vi.hoisted(() => ({
  authChecked: false,
  me: null as { id: string; email: string } | null,
  positionReady: false,
}));

vi.mock('./hooks/useWorldAppCore', () => ({
  useWorldAppCore: (params: {
    auth: {
      setAuthChecked: (v: boolean) => void;
      setMe: (v: { id: string; email: string } | null) => void;
      setPositionReady: (v: boolean) => void;
    };
  }) => {
    // useState setters keep their identity, so this drives the auth state once
    // instead of on every render — exactly like the real hook's useFetchMe.
    const { setAuthChecked, setMe, setPositionReady } = params.auth;
    React.useEffect(() => {
      if (scenario.authChecked) setAuthChecked(true);
      if (scenario.me) setMe(scenario.me);
      if (scenario.positionReady) setPositionReady(true);
    }, [setAuthChecked, setMe, setPositionReady]);

    return {
      desktop: { isTauri: false, isMiniMode: false, toggleMiniMode: async () => {}, desktop: null },
      editor: {},
      eventHandlers: {},
      getRoom: () => null,
      saveAllToServer: () => Promise.resolve(false),
      handleAuthComplete: async () => {},
      pttAwareToggleMic: null,
      participantsToRender: [],
      isTenantAdmin: false,
      paymentStatus: null,
      handleManageBilling: async () => {},
      showReloadBanner: false,
      getDisplayName: () => '',
      getMiniZones: () => [],
      handleExpandWithScreen: () => {},
    };
  },
}));

vi.mock('./components/MiniModeWorldSignal', () => ({
  MiniModeWorldSignal: () => <div data-testid="mini-signal" />,
}));
vi.mock('./components/WorldShell', () => ({ WorldShell: () => <div data-testid="world-shell" /> }));
vi.mock('./components/AuthLoadingScreen', () => ({
  AuthLoadingScreen: () => <div data-testid="auth-loading" />,
}));

beforeEach(() => {
  scenario.authChecked = false;
  scenario.me = null;
  scenario.positionReady = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorldApp auth gate', () => {
  it('does not report the world while the auth check is still running', async () => {
    const { queryByTestId, getByTestId } = render(<WorldApp />);
    await waitFor(() => expect(getByTestId('auth-loading')).toBeInTheDocument());
    expect(queryByTestId('mini-signal')).toBeNull();
  });

  it('does not report the world when the check came back without a session', async () => {
    // AuthLoadingScreen sends this case to #/login, where AppRoutes reports the
    // public page. Reporting the world here would shrink the window first.
    scenario.authChecked = true;
    scenario.positionReady = true;
    const { queryByTestId, getByTestId } = render(<WorldApp />);
    await waitFor(() => expect(getByTestId('auth-loading')).toBeInTheDocument());
    expect(queryByTestId('mini-signal')).toBeNull();
  });

  it('does not report the world before the position is ready', async () => {
    scenario.authChecked = true;
    scenario.me = { id: 'u1', email: 'a@b.c' };
    const { queryByTestId, getByTestId } = render(<WorldApp />);
    await waitFor(() => expect(getByTestId('auth-loading')).toBeInTheDocument());
    expect(queryByTestId('mini-signal')).toBeNull();
  });

  it('reports the world exactly once when the world is really on screen', async () => {
    scenario.authChecked = true;
    scenario.me = { id: 'u1', email: 'a@b.c' };
    scenario.positionReady = true;
    const { getByTestId, queryAllByTestId, queryByTestId } = render(<WorldApp />);
    await waitFor(() => expect(getByTestId('world-shell')).toBeInTheDocument());
    expect(queryAllByTestId('mini-signal')).toHaveLength(1);
    expect(queryByTestId('auth-loading')).toBeNull();
  });
});
