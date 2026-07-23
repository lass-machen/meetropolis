import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  isAudioSessionApiAvailable,
  computeAudioDuckingEnabled,
  setAudioDuckingPreference,
  setAudioDuckingDndActive,
  setAudioCaptureNeeded,
  resolveAudioSessionType,
  resetAudioDucking,
} from './audioSessionDucking';

describe('audioSessionDucking', () => {
  const originalAudioSession = navigator.audioSession;

  afterEach(() => {
    resetAudioDucking();
    // Restore original state
    if (originalAudioSession === undefined) {
      delete (navigator as any).audioSession;
    } else {
      (navigator as any).audioSession = originalAudioSession;
    }
  });

  describe('isAudioSessionApiAvailable', () => {
    it('returns true when navigator.audioSession exists', () => {
      (navigator as any).audioSession = { type: 'auto' };
      expect(isAudioSessionApiAvailable()).toBe(true);
    });

    it('returns false when navigator.audioSession is undefined', () => {
      delete (navigator as any).audioSession;
      expect(isAudioSessionApiAvailable()).toBe(false);
    });

    it('returns false when navigator.audioSession is null', () => {
      (navigator as any).audioSession = null;
      expect(isAudioSessionApiAvailable()).toBe(false);
    });
  });

  describe('computeAudioDuckingEnabled', () => {
    it('is enabled only when the preference is on and DND is off', () => {
      expect(computeAudioDuckingEnabled({ preferenceEnabled: true, dndActive: false })).toBe(true);
      expect(computeAudioDuckingEnabled({ preferenceEnabled: true, dndActive: true })).toBe(false);
      expect(computeAudioDuckingEnabled({ preferenceEnabled: false, dndActive: false })).toBe(false);
      expect(computeAudioDuckingEnabled({ preferenceEnabled: false, dndActive: true })).toBe(false);
    });
  });

  describe('setAudioDuckingPreference', () => {
    beforeEach(() => {
      (navigator as any).audioSession = { type: 'auto' };
      resetAudioDucking();
    });

    it('sets type to "playback" when ducking is disabled', () => {
      setAudioDuckingPreference(false);
      expect(navigator.audioSession!.type).toBe('playback');
    });

    it('sets type to "auto" when ducking is enabled', () => {
      // Start from a non-auto state to verify it changes
      navigator.audioSession!.type = 'playback';
      setAudioDuckingPreference(true);
      expect(navigator.audioSession!.type).toBe('auto');
    });

    it('is a no-op when API is unavailable (no error thrown)', () => {
      delete (navigator as any).audioSession;
      expect(() => setAudioDuckingPreference(false)).not.toThrow();
      expect(() => setAudioDuckingPreference(true)).not.toThrow();
    });
  });

  describe('setAudioDuckingDndActive', () => {
    beforeEach(() => {
      (navigator as any).audioSession = { type: 'auto' };
      resetAudioDucking();
    });

    it('suppresses ducking on DND entry even when the preference allows it', () => {
      setAudioDuckingPreference(true);
      setAudioDuckingDndActive(true);
      expect(navigator.audioSession!.type).toBe('playback');
    });

    it('restores the preference on DND exit', () => {
      setAudioDuckingDndActive(true);
      setAudioDuckingDndActive(false);
      expect(navigator.audioSession!.type).toBe('auto');
    });

    it('keeps ducking off after DND exit when the preference disables it', () => {
      setAudioDuckingPreference(false);
      setAudioDuckingDndActive(true);
      setAudioDuckingDndActive(false);
      expect(navigator.audioSession!.type).toBe('playback');
    });

    it('preference changes during DND do not re-enable ducking', () => {
      setAudioDuckingDndActive(true);
      setAudioDuckingPreference(true);
      expect(navigator.audioSession!.type).toBe('playback');
    });

    it('is a no-op when API is unavailable (no error thrown)', () => {
      delete (navigator as any).audioSession;
      expect(() => setAudioDuckingDndActive(true)).not.toThrow();
      expect(() => setAudioDuckingDndActive(false)).not.toThrow();
    });
  });

  describe('capture compatibility (regression: could not unmute)', () => {
    // Desktop 0.2.21/0.2.22: with ducking suppression on, the session sat in
    // 'playback', and WebKit rejects capture in that category with
    // "InvalidStateError: AudioSession category is not compatible with audio
    // capture". Harmless while a track stayed open — but the hybrid mute
    // releases the hardware after sustained mute, so unmuting had to reopen the
    // device and hit exactly that rejection. Reproduced live on macOS.
    it('never sits in playback while capture is needed', () => {
      expect(resolveAudioSessionType({ preferenceEnabled: false, dndActive: false, micCaptureNeeded: true })).toBe(
        'play-and-record',
      );
      expect(resolveAudioSessionType({ preferenceEnabled: true, dndActive: true, micCaptureNeeded: true })).toBe(
        'play-and-record',
      );
    });

    it('still suppresses ducking with playback while no capture is needed', () => {
      // The whole point of the setting: muted, hardware released, recording
      // indicator off, nothing ducking system audio.
      expect(resolveAudioSessionType({ preferenceEnabled: false, dndActive: false, micCaptureNeeded: false })).toBe(
        'playback',
      );
    });

    it('leaves the session on auto whenever ducking is wanted', () => {
      expect(resolveAudioSessionType({ preferenceEnabled: true, dndActive: false, micCaptureNeeded: false })).toBe(
        'auto',
      );
      expect(resolveAudioSessionType({ preferenceEnabled: true, dndActive: false, micCaptureNeeded: true })).toBe(
        'auto',
      );
    });

    it('walks the real mute cycle without ever forbidding capture', () => {
      (navigator as any).audioSession = { type: 'auto' };
      setAudioDuckingPreference(false); // user switched ducking off
      setAudioCaptureNeeded(true); // talking
      expect(navigator.audioSession!.type).toBe('play-and-record');

      setAudioCaptureNeeded(false); // muted long enough, hardware released
      expect(navigator.audioSession!.type).toBe('playback');

      setAudioCaptureNeeded(true); // unmuting again — this is where it broke
      expect(navigator.audioSession!.type).not.toBe('playback');
      expect(navigator.audioSession!.type).toBe('play-and-record');
    });

    it('does nothing on engines without the api (chromium, windows webview2)', () => {
      delete (navigator as any).audioSession;
      expect(() => {
        setAudioDuckingPreference(false);
        setAudioCaptureNeeded(true);
        setAudioCaptureNeeded(false);
      }).not.toThrow();
    });
  });
});
