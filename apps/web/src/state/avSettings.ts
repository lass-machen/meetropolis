import { create } from 'zustand';

export type AvPreset = 'standard' | 'quiet' | 'loud' | 'studio';

export type AvSettings = {
  // WebRTC constraints
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  sampleRate: 48000;
  channelCount: 1;

  // Opus/Publish tuning
  opusBitrateKbps: number; // target speech bitrate
  useDtx: boolean;
  useFec: boolean;

  // Light DSP (WebAudio)
  highpassFilter: boolean;
  compressor: boolean;

  // Voice isolation
  clientVoiceIsolation: boolean; // RNNoise worklet, if available
  serverVoiceIsolation: boolean; // LiveKit/Krisp (only if server supports it)

  // Push-to-Talk
  pushToTalk: boolean;
  pushToTalkKey: string;

  // Behavior
  // Hybrid mute: muting always soft-mutes instantly (RTP-mute, capture stays
  // open) for a snappy, clip-free toggle. When this is true, the capture is
  // additionally released after a short grace period of sustained mute
  // (VITE_MIC_RELEASE_DELAY_MS, default 4s) to free the device and clear the OS
  // recording indicator — a quick unmute cancels that release. When false, the
  // mic stays soft-muted indefinitely (capture never released while muted).
  // See TrackManager.applyMicrophoneDesired / scheduleMicHardwareRelease.
  stopMicOnMute: boolean;

  // Preset selection
  preset: AvPreset;
};

type AvSettingsStore = {
  settings: AvSettings;
  setSetting: <K extends keyof AvSettings>(key: K, value: AvSettings[K]) => void;
  setSettings: (next: Partial<AvSettings>) => void;
  applyPreset: (preset: AvPreset) => void;
  reset: () => void;
};

const STORAGE_KEY = 'meetropolis.av.settings.v1';

const DEFAULTS: AvSettings = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  sampleRate: 48000,
  channelCount: 1,
  opusBitrateKbps: 28, // ~28 kbps speech good quality
  useDtx: true,
  useFec: true,
  highpassFilter: true,
  compressor: false,
  clientVoiceIsolation: true,
  serverVoiceIsolation: false,
  pushToTalk: false,
  pushToTalkKey: 'Space',
  stopMicOnMute: true,
  preset: 'standard',
};

function loadFromStorage(): Partial<AvSettings> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<AvSettings>;
    return parsed || {};
  } catch {
    return {};
  }
}

function saveToStorage(settings: AvSettings): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

function buildPreset(preset: AvPreset): Partial<AvSettings> {
  if (preset === 'standard') {
    return {
      preset,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      highpassFilter: true,
      compressor: false,
      opusBitrateKbps: 28,
      useDtx: true,
      useFec: true,
    };
  }
  if (preset === 'quiet') {
    return {
      preset,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      highpassFilter: true,
      compressor: false,
      opusBitrateKbps: 24,
      useDtx: true,
      useFec: true,
    };
  }
  if (preset === 'loud') {
    // aggressiver: eher niedrigere Bitrate + DTX, HPF + leichter Kompressor an
    return {
      preset,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      highpassFilter: true,
      compressor: true,
      opusBitrateKbps: 24,
      useDtx: true,
      useFec: true,
    };
  }
  // studio
  return {
    preset,
    noiseSuppression: true,
    echoCancellation: false,
    autoGainControl: false,
    highpassFilter: false,
    compressor: false,
    opusBitrateKbps: 40,
    useDtx: false,
    useFec: true,
  };
}

export const useAvSettingsStore = create<AvSettingsStore>((set, get) => {
  const persisted = loadFromStorage();
  const initial: AvSettings = { ...DEFAULTS, ...persisted };
  return {
    settings: initial,
    setSetting: (key, value) => {
      const next = { ...get().settings, [key]: value } as AvSettings;
      set({ settings: next });
      saveToStorage(next);
    },
    setSettings: (patch) => {
      const next = { ...get().settings, ...patch } as AvSettings;
      set({ settings: next });
      saveToStorage(next);
    },
    applyPreset: (preset) => {
      const patch = buildPreset(preset);
      const next = { ...get().settings, ...patch } as AvSettings;
      set({ settings: next });
      saveToStorage(next);
    },
    reset: () => {
      set({ settings: { ...DEFAULTS } });
      saveToStorage({ ...DEFAULTS });
    },
  };
});
