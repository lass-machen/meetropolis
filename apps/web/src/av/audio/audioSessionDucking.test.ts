import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { isAudioSessionApiAvailable, applyAudioDuckingPreference } from './audioSessionDucking';

describe('audioSessionDucking', () => {
  const originalAudioSession = navigator.audioSession;

  afterEach(() => {
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

  describe('applyAudioDuckingPreference', () => {
    beforeEach(() => {
      (navigator as any).audioSession = { type: 'auto' };
    });

    it('sets type to "playback" when ducking is disabled', () => {
      applyAudioDuckingPreference(false);
      expect(navigator.audioSession!.type).toBe('playback');
    });

    it('sets type to "auto" when ducking is enabled', () => {
      // Start from a non-auto state to verify it changes
      navigator.audioSession!.type = 'playback';
      applyAudioDuckingPreference(true);
      expect(navigator.audioSession!.type).toBe('auto');
    });

    it('is a no-op when API is unavailable (no error thrown)', () => {
      delete (navigator as any).audioSession;
      expect(() => applyAudioDuckingPreference(false)).not.toThrow();
      expect(() => applyAudioDuckingPreference(true)).not.toThrow();
    });
  });
});
