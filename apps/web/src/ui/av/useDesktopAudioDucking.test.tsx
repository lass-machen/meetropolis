import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// Pretend to run in the macOS desktop WebView. The platform alone must not be
// enough to show the control: only the capability the desktop module reports
// decides (a macOS build without a working native path reports false).
vi.hoisted(() => {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    configurable: true,
  });
});

// The hook must drive the web audio-session preference (AUVoiceIO / voice-
// activity ducking) on every toggle — not just the native DuckOthers command.
// Regression guard: this wiring was previously dead, so the setting had no
// audible effect.
const setAudioDuckingPreference = vi.fn();
vi.mock('../../av/audio/audioSessionDucking', () => ({
  setAudioDuckingPreference: (enabled: boolean) => setAudioDuckingPreference(enabled),
}));

// No desktop module by default → native path stays a no-op; the web
// preference wiring under test is independent of it. Capability tests swap in
// a module below.
let desktopModule: Record<string, unknown> | null = null;
vi.mock('../../lib/desktopLoader', () => ({
  getDesktopModule: () => Promise.resolve(desktopModule),
}));

import { useDesktopAudioDucking } from './useDesktopAudioDucking';

describe('useDesktopAudioDucking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktopModule = null;
  });

  it('applies the web audio-session preference when the toggle changes', () => {
    const { result } = renderHook(() => useDesktopAudioDucking(true));

    act(() => result.current.set(false));
    expect(setAudioDuckingPreference).toHaveBeenCalledWith(false);

    act(() => result.current.set(true));
    expect(setAudioDuckingPreference).toHaveBeenCalledWith(true);
  });

  it('optimistically reflects the toggled value', () => {
    const { result } = renderHook(() => useDesktopAudioDucking(true));

    act(() => result.current.set(false));
    expect(result.current.value).toBe(false);
  });
});

describe('useDesktopAudioDucking capability gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktopModule = null;
  });

  const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  it('keeps the control hidden when the desktop module reports no support', async () => {
    const getAudioDucking = vi.fn().mockResolvedValue(true);
    desktopModule = {
      supportsAudioDucking: vi.fn().mockResolvedValue(false),
      getAudioDucking,
      setAudioDucking: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useDesktopAudioDucking(true));
    await flush();

    expect(result.current.available).toBe(false);
    expect(result.current.value).toBeNull();
    expect(getAudioDucking).not.toHaveBeenCalled();
  });

  it('keeps the control hidden when the desktop module has no capability query', async () => {
    desktopModule = {
      getAudioDucking: vi.fn().mockResolvedValue(true),
      setAudioDucking: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useDesktopAudioDucking(true));
    await flush();

    expect(result.current.available).toBe(false);
  });

  it('keeps the control hidden when the capability query rejects', async () => {
    desktopModule = {
      supportsAudioDucking: vi.fn().mockRejectedValue(new Error('no native command')),
      getAudioDucking: vi.fn().mockResolvedValue(true),
      setAudioDucking: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useDesktopAudioDucking(true));
    await flush();

    expect(result.current.available).toBe(false);
  });

  it('shows the control with the stored value when support is reported', async () => {
    desktopModule = {
      supportsAudioDucking: vi.fn().mockResolvedValue(true),
      getAudioDucking: vi.fn().mockResolvedValue(false),
      setAudioDucking: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useDesktopAudioDucking(true));

    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.value).toBe(false);
  });
});
