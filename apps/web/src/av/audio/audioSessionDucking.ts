/**
 * Controls macOS audio ducking via the W3C Audio Session API.
 * Only effective in WKWebView (Safari 16.4+ / macOS 13.3+).
 *
 * Session type 'playback' prevents WebKit from activating the AUVoiceIO
 * audio unit that causes system-wide ducking; 'auto' (default) lets WebKit
 * manage the session normally.
 *
 * Two inputs decide the effective session type:
 * - the user preference (desktop setting, ducking enabled by default),
 * - the local Do Not Disturb state: DND suppresses incoming conversation
 *   audio, so there is nothing to duck for. Because DND only soft-mutes the
 *   microphone (capture stays open to avoid SDP renegotiation), the
 *   voice-processing session would otherwise keep ducking system audio for
 *   the whole DND phase.
 */

interface AudioDuckingInputs {
  preferenceEnabled: boolean;
  dndActive: boolean;
  /**
   * Whether the microphone capture is currently needed. Set while a mic track
   * is being opened, cleared once the hybrid mute released the hardware.
   */
  micCaptureNeeded: boolean;
}

const inputs: AudioDuckingInputs = { preferenceEnabled: true, dndActive: false, micCaptureNeeded: false };

export function isAudioSessionApiAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'audioSession' in navigator && navigator.audioSession != null;
}

export function computeAudioDuckingEnabled(
  state: Pick<AudioDuckingInputs, 'preferenceEnabled' | 'dndActive'>,
): boolean {
  return state.preferenceEnabled && !state.dndActive;
}

/**
 * Resolve the session type from the ducking wish AND whether capture is needed.
 *
 * There is no category that both suppresses ducking and permits capture, so the
 * two cannot be satisfied at the same time. `'playback'` is what actually stops
 * WebKit from activating AUVoiceIO — but it means, literally, "this page only
 * plays back", and WebKit then rejects every `getUserMedia` call with
 * `InvalidStateError: AudioSession category is not compatible with audio
 * capture`.
 *
 * That was survivable while a capture track, once opened, simply kept running.
 * The hybrid mute changed it: sustained mute now releases the hardware, and
 * unmuting has to open the device again — straight into the rejection. Users
 * with ducking switched off could not unmute at all (desktop 0.2.21/0.2.22).
 *
 * So `'playback'` is used only while no capture is needed — which is exactly
 * when the setting matters: muted, hardware released, system recording
 * indicator off, nothing ducking the music. As soon as the microphone is wanted
 * again the session moves to `'play-and-record'`, accepting that ducking may
 * occur while actually speaking, which is the moment it bothers no one.
 */
export function resolveAudioSessionType(state: AudioDuckingInputs): 'auto' | 'playback' | 'play-and-record' {
  if (computeAudioDuckingEnabled(state)) return 'auto';
  return state.micCaptureNeeded ? 'play-and-record' : 'playback';
}

function applySessionType(): void {
  if (!isAudioSessionApiAvailable()) return;
  navigator.audioSession!.type = resolveAudioSessionType(inputs);
}

/**
 * Declare whether microphone capture is needed. MUST be called with `true`
 * before opening a capture device, otherwise a suppressed-ducking session is
 * still in `'playback'` and the open is rejected.
 */
export function setAudioCaptureNeeded(needed: boolean): void {
  if (inputs.micCaptureNeeded === needed) return;
  inputs.micCaptureNeeded = needed;
  applySessionType();
}

export function setAudioDuckingPreference(enabled: boolean): void {
  inputs.preferenceEnabled = enabled;
  applySessionType();
}

export function setAudioDuckingDndActive(active: boolean): void {
  inputs.dndActive = active;
  applySessionType();
}

export function resetAudioDucking(): void {
  inputs.preferenceEnabled = true;
  inputs.dndActive = false;
  inputs.micCaptureNeeded = false;
  applySessionType();
}
