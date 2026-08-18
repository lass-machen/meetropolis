import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useMiniModeAuthGuard, type MiniModePage } from './useMiniModeAuthGuard';
import { useDesktop, type DesktopState } from './useDesktop';

vi.mock('./useDesktop', () => ({ useDesktop: vi.fn() }));

/**
 * Build a desktop bridge stub and install it as the useDesktop result. The
 * callback keeps a stable identity across renders, exactly like the real hook's
 * useCallback value — useDesktop.test.ts is what pins that property on the real
 * hook, this file assumes it.
 */
function stubDesktop(opts: { isTauri?: boolean; fail?: boolean } = {}) {
  // Typed explicitly so the recorded calls keep their argument tuple: the
  // implementation ignores it, the assertions below do not.
  const setWorldVisible = vi.fn<(visible: boolean) => Promise<void>>(() =>
    opts.fail ? Promise.reject(new Error('bridge is gone')) : Promise.resolve(),
  );
  const toggleMiniMode = vi.fn(async () => {});
  const state: DesktopState = {
    isTauri: opts.isTauri ?? true,
    isMiniMode: false,
    toggleMiniMode,
    setWorldVisible,
    desktop: null,
  };
  vi.mocked(useDesktop).mockReturnValue(state);
  const publish = (patch: Partial<DesktopState>) => vi.mocked(useDesktop).mockReturnValue({ ...state, ...patch });
  return { state, publish, setWorldVisible, toggleMiniMode };
}

function renderGuard(page: MiniModePage) {
  return renderHook(({ p }: { p: MiniModePage }) => useMiniModeAuthGuard(p), {
    initialProps: { p: page },
  });
}

/**
 * Re-render and drain the microtask queue, so a "was not called" assertion looks
 * at the state after the guard had its chance to act.
 */
async function rerenderAndSettle(rerender: (props: { p: MiniModePage }) => void, page: MiniModePage) {
  await act(async () => {
    rerender({ p: page });
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useMiniModeAuthGuard', () => {
  it('does nothing in an OSS browser build that has no desktop module', async () => {
    const { setWorldVisible } = stubDesktop({ isTauri: false });
    const { rerender } = renderGuard('public');
    await rerenderAndSettle(rerender, 'world');
    expect(setWorldVisible).not.toHaveBeenCalled();
  });

  it('reports a public page so the window leaves mini mode', async () => {
    const { setWorldVisible } = stubDesktop();
    renderGuard('public');
    await waitFor(() => expect(setWorldVisible).toHaveBeenCalledWith(false));
  });

  it('reports the world once it is on screen', async () => {
    const { setWorldVisible } = stubDesktop();
    renderGuard('world');
    await waitFor(() => expect(setWorldVisible).toHaveBeenCalledWith(true));
  });

  // The world route before the auth verdict. Reporting either way here is what
  // used to shrink the window around the login page (and would expand it on
  // every reload), so the guard has to stay quiet.
  it('reports nothing while the visible page is still undecided', async () => {
    const { setWorldVisible } = stubDesktop();
    const { rerender } = renderGuard('unknown');
    await rerenderAndSettle(rerender, 'unknown');
    expect(setWorldVisible).not.toHaveBeenCalled();
  });

  it('goes quiet again when a decided page turns undecided', async () => {
    const { setWorldVisible } = stubDesktop();
    const { rerender } = renderGuard('world');
    await waitFor(() => expect(setWorldVisible).toHaveBeenCalledWith(true));
    setWorldVisible.mockClear();

    await rerenderAndSettle(rerender, 'unknown');
    expect(setWorldVisible).not.toHaveBeenCalled();
  });

  it('reports every page change, in both directions', async () => {
    const { setWorldVisible } = stubDesktop();
    const { rerender } = renderGuard('public');
    await waitFor(() => expect(setWorldVisible).toHaveBeenCalledWith(false));

    await rerenderAndSettle(rerender, 'world');
    await waitFor(() => expect(setWorldVisible).toHaveBeenCalledWith(true));

    await rerenderAndSettle(rerender, 'public');
    await waitFor(() => expect(setWorldVisible).toHaveBeenCalledTimes(3));
    expect(setWorldVisible.mock.calls.map(([visible]) => visible)).toEqual([false, true, false]);
  });

  // Re-renders are not page changes. A guard that fires on every render would
  // talk to the bridge dozens of times per second in the world, and the desktop
  // side would have to absorb all of it.
  it('does not report again when the page stays the same across re-renders', async () => {
    const { publish, setWorldVisible } = stubDesktop();
    const { rerender } = renderGuard('public');
    await waitFor(() => expect(setWorldVisible).toHaveBeenCalledTimes(1));

    // Cmd+M on the login screen: the desktop bridge reports the new mode, which
    // re-renders every useDesktop consumer.
    publish({ isMiniMode: true });
    await rerenderAndSettle(rerender, 'public');
    await rerenderAndSettle(rerender, 'public');

    expect(setWorldVisible).toHaveBeenCalledTimes(1);
  });

  it('syncs as soon as the desktop module has resolved', async () => {
    // useDesktop reports isTauri only after the dynamic module import settles.
    // The first effect run therefore sees a browser build; the guard has to act
    // on the flip, otherwise a mini window on the login page never expands.
    const { publish, setWorldVisible } = stubDesktop({ isTauri: false });
    const { rerender } = renderGuard('public');
    expect(setWorldVisible).not.toHaveBeenCalled();

    publish({ isTauri: true });
    await rerenderAndSettle(rerender, 'public');
    await waitFor(() => expect(setWorldVisible).toHaveBeenCalledWith(false));
  });

  it('survives a rejecting bridge call', async () => {
    const { setWorldVisible } = stubDesktop({ fail: true });
    const { rerender } = renderGuard('public');
    await waitFor(() => expect(setWorldVisible).toHaveBeenCalled());
    // An unhandled rejection would fail the run; a size change is not worth that.
    await rerenderAndSettle(rerender, 'world');
    await waitFor(() => expect(setWorldVisible).toHaveBeenCalledTimes(2));
  });

  it('reports nothing on unmount, so a re-auth does not flap the window', async () => {
    const { setWorldVisible } = stubDesktop();
    const { unmount } = renderGuard('world');
    await waitFor(() => expect(setWorldVisible).toHaveBeenCalledWith(true));
    setWorldVisible.mockClear();

    await act(async () => {
      unmount();
      await Promise.resolve();
    });
    expect(setWorldVisible).not.toHaveBeenCalled();
  });
});
