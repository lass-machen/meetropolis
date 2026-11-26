import * as React from 'react';
import { getDesktopModule } from '../../lib/desktopLoader';

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
    void setRef.current?.(enabled).catch(() => setValue(!enabled));
  }, []);

  return { value, available, set };
}
