import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { resetMemberAssets } from '../../../lib/memberAssets';
import { useWorldEventHandlers } from './useWorldEventHandlers';

vi.mock('../../../lib/memberAssets', () => ({ resetMemberAssets: vi.fn() }));

type Params = Parameters<typeof useWorldEventHandlers>[0];

describe('useWorldEventHandlers handleOpenApi', () => {
  it('opens the API tokens overlay and closes the menu', () => {
    const setApiModalOpen = vi.fn();
    const setMenuOpen = vi.fn();
    const { result } = renderHook(() =>
      useWorldEventHandlers({
        apiBase: '',
        avState: {},
        editor: {},
        contextMenu: {},
        setApiModalOpen,
        setMenuOpen,
      } as unknown as Params),
    );

    act(() => result.current.handleOpenApi());

    expect(setApiModalOpen).toHaveBeenCalledWith(true);
    expect(setMenuOpen).toHaveBeenCalledWith(false);
  });
});

describe('useWorldEventHandlers member asset reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
  });

  function renderHandlers() {
    return renderHook(() =>
      useWorldEventHandlers({
        apiBase: 'https://app.example.test',
        avState: {},
        editor: {},
        contextMenu: {},
        avRef: { current: null },
        colyseusRef: { current: null },
        setMe: vi.fn(),
        setMenuOpen: vi.fn(),
        setPage: vi.fn(),
      } as unknown as Params),
    );
  }

  it('releases member assets exactly once on logout', async () => {
    const { result } = renderHandlers();

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(resetMemberAssets).toHaveBeenCalledTimes(1);
  });

  it('releases member assets exactly once on full reset', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload }, writable: true, configurable: true });
    const { result } = renderHandlers();

    await act(async () => {
      await result.current.handleResetApp();
    });

    expect(resetMemberAssets).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
