import * as React from 'react';
import { getDesktopModule } from '../../lib/desktopLoader';
import { setAudioDuckingPreference } from '../../av/audio/audioSessionDucking';

export interface DesktopAudioDucking {
  /** null while unknown / unavailable — callers hide the control then. */
  value: boolean | null;
  available: boolean;
  set: (enabled: boolean) => void;
}

/**
 * Reads and writes the native audio-ducking preference through the desktop
 * module, keeping the OSS settings dialog free of any @tauri-apps dependency.
 * The control is offered only when the desktop module reports
 * `supportsAudioDucking() === true`; a missing method, a rejection or `false`
 * keeps it hidden, so it never appears as a dead control in the browser, on
 * other platforms or on an OS version without a working native path.
 * `active` should track modal visibility so the value is (re)loaded on open.
 */
export function useDesktopAudioDucking(active: boolean): DesktopAudioDucking {
  const [value, setValue] = React.useState<boolean | null>(null);
  const [available, setAvailable] = React.useState(false);
  const setRef = React.useRef<((v: boolean) => Promise<void>) | null>(null);

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void getDesktopModule().then(async (mod) => {
      if (cancelled || !mod?.supportsAudioDucking || !mod.setAudioDucking || !mod.getAudioDucking) return;
      try {
        if (!(await mod.supportsAudioDucking())) return;
        const cur = await mod.getAudioDucking();
        if (!cancelled) {
          setRef.current = mod.setAudioDucking;
          setAvailable(true);
          setValue(cur);
          // Keep the web audio session (WKWebView's AUVoiceIO ducking, the
          // voice-activity one) in sync with the native preference. This is the
          // only lever over that layer; without it the setting only moves the
          // native DuckOthers duck and the audible ducking never changes.
          setAudioDuckingPreference(cur);
        }
      } catch {
        /* ignore: leave value null so the control stays hidden */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const set = React.useCallback((enabled: boolean) => {
    setValue(enabled);
    // Drive both layers: the web audio session (AUVoiceIO, voice-activity
    // ducking) and the native DuckOthers duck. WebKit may only fully apply a
    // session-type change at the next capture session, so a live toggle can
    // need an app restart to take full effect — startup application covers that.
    setAudioDuckingPreference(enabled);
    void setRef.current?.(enabled).catch(() => setValue(!enabled));
  }, []);

  return { value, available, set };
}
