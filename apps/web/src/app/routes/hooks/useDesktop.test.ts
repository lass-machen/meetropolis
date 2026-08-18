import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useDesktop } from './useDesktop';
import { getDesktopModule, type DesktopModule } from '../../../lib/desktopLoader';

vi.mock('../../../lib/desktopLoader', () => ({ getDesktopModule: vi.fn() }));

/** Minimal stand-in for the desktop module; useDesktop only checks presence. */
function stubModule(): DesktopModule {
  return {
    initDesktop: () => {},
    waitForConfig: async () => {},
    MiniModeView: () => null,
    TauriPreferencesModal: () => null,
    UpdateBanner: () => null,
    openExternal: async () => {},
    setDesktopAuthToken: () => {},
  };
}

function installBridge(bridge: NonNullable<Window['__DESKTOP__']>) {
  window.__DESKTOP__ = bridge;
}

beforeEach(() => {
  vi.mocked(getDesktopModule).mockResolvedValue(stubModule());
});

afterEach(() => {
  cleanup();
  delete window.__DESKTOP__;
  vi.clearAllMocks();
});

describe('useDesktop', () => {
  it('keeps setWorldVisible stable across re-renders', async () => {
    // The mini-mode guard depends on this function. An identity that changes per
    // render would re-run its effect on every unrelated state change, so the
    // desktop bridge would be called dozens of times per second in the world.
    const setWorldVisible = vi.fn(() => Promise.resolve(true));
    installBridge({ isMiniMode: false, setWorldVisible });

    const { result, rerender } = renderHook(() => useDesktop());
    const first = result.current.setWorldVisible;
    // Wait for the module import to settle: that state update is a re-render in
    // its own right, and it must not swap the function either.
    await waitFor(() => expect(result.current.isTauri).toBe(true));
    rerender();
    rerender();

    expect(result.current.setWorldVisible).toBe(first);
  });

  it('forwards the reported visibility to the bridge', async () => {
    const setWorldVisible = vi.fn(() => Promise.resolve(true));
    installBridge({ isMiniMode: false, setWorldVisible });

    const { result } = renderHook(() => useDesktop());
    await act(async () => {
      await result.current.setWorldVisible(true);
    });

    expect(setWorldVisible).toHaveBeenCalledWith(true);
  });

  // The hosted build bundles the desktop module, so isTauri is true even in
  // Chrome on meetropolis.me. What makes the calls harmless there is the absent
  // window.__DESKTOP__ — initDesktop() returns early without window.__TAURI__ —
  // not the isTauri flag.
  it('resolves without a bridge at all, which is the hosted browser build', async () => {
    const { result } = renderHook(() => useDesktop());
    await waitFor(() => expect(result.current.isTauri).toBe(true));

    await expect(result.current.setWorldVisible(false)).resolves.toBeUndefined();
    expect(result.current.isMiniMode).toBe(false);
  });

  // Version skew: a desktop client built before set_world_visible existed runs
  // this newer web bundle. It has to keep working, not throw.
  it('resolves against a desktop build that lacks setWorldVisible', async () => {
    const toggleMiniMode = vi.fn(async () => {});
    installBridge({ isMiniMode: true, toggleMiniMode });

    const { result } = renderHook(() => useDesktop());
    await waitFor(() => expect(result.current.isTauri).toBe(true));

    await expect(result.current.setWorldVisible(true)).resolves.toBeUndefined();
    // The old toggle path is untouched by the missing command.
    await act(async () => {
      await result.current.toggleMiniMode();
    });
    expect(toggleMiniMode).toHaveBeenCalled();
  });

  it('stays inert in an OSS build where no desktop module loads', async () => {
    vi.mocked(getDesktopModule).mockResolvedValue(null);
    const toggleMiniMode = vi.fn(async () => {});
    installBridge({ isMiniMode: false, toggleMiniMode });

    const { result } = renderHook(() => useDesktop());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isTauri).toBe(false);
    expect(result.current.desktop).toBeNull();
    await act(async () => {
      await result.current.toggleMiniMode();
    });
    expect(toggleMiniMode).not.toHaveBeenCalled();
  });

  it('picks up mini-mode changes announced by the bridge', async () => {
    installBridge({ isMiniMode: false, setWorldVisible: vi.fn(() => Promise.resolve(true)) });
    const { result } = renderHook(() => useDesktop());
    await waitFor(() => expect(result.current.isTauri).toBe(true));

    act(() => {
      window.dispatchEvent(new CustomEvent('desktop:mini-mode-changed', { detail: { isMiniMode: true } }));
    });
    expect(result.current.isMiniMode).toBe(true);

    act(() => {
      window.dispatchEvent(new CustomEvent('desktop:mini-mode-changed', { detail: { isMiniMode: false } }));
    });
    expect(result.current.isMiniMode).toBe(false);
  });
});
