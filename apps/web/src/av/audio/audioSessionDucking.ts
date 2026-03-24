/**
 * Controls macOS audio ducking via the W3C Audio Session API.
 * Only effective in WKWebView (Safari 16.4+ / macOS 13.3+).
 *
 * When ducking is disabled, sets session type to 'playback' which prevents
 * WebKit from activating the AUVoiceIO audio unit that causes ducking.
 * When enabled (default), sets 'auto' to let WebKit manage normally.
 */

export function isAudioSessionApiAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'audioSession' in navigator &&
    navigator.audioSession != null
  );
}

export function applyAudioDuckingPreference(duckingEnabled: boolean): void {
  if (!isAudioSessionApiAvailable()) return;
  navigator.audioSession!.type = duckingEnabled ? 'auto' : 'playback';
}
