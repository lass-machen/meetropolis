import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// The hook must drive the web audio-session preference (AUVoiceIO / voice-
// activity ducking) on every toggle — not just the native DuckOthers command.
// Regression guard: this wiring was previously dead, so the setting had no
// audible effect.
const setAudioDuckingPreference = vi.fn();
vi.mock('../../av/audio/audioSessionDucking', () => ({
  setAudioDuckingPreference: (enabled: boolean) => setAudioDuckingPreference(enabled),
}));

// No desktop module in the test env → native path stays a no-op; the web
// preference wiring under test is independent of it.
vi.mock('../../lib/desktopLoader', () => ({
  getDesktopModule: () => Promise.resolve(null),
}));

import { useDesktopAudioDucking } from './useDesktopAudioDucking';

describe('useDesktopAudioDucking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
