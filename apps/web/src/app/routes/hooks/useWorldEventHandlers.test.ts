import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorldEventHandlers } from './useWorldEventHandlers';

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
