import { create } from 'zustand';

export type CameraSettings = {
  centerCamera: boolean;
};

type CameraSettingsStore = {
  settings: CameraSettings;
  setSetting<K extends keyof CameraSettings>(key: K, value: CameraSettings[K]): void;
};

const STORAGE_KEY = 'meetropolis.camera.settings.v1';

const DEFAULTS: CameraSettings = {
  centerCamera: false,
};

function loadFromStorage(): Partial<CameraSettings> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<CameraSettings>;
  } catch {
    return {};
  }
}

function saveToStorage(settings: CameraSettings): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export const useCameraSettingsStore = create<CameraSettingsStore>((set, get) => {
  const persisted = loadFromStorage();
  const initial: CameraSettings = { ...DEFAULTS, ...persisted };
  return {
    settings: initial,
    setSetting: (key, value) => {
      const next = { ...get().settings, [key]: value };
      set({ settings: next });
      saveToStorage(next);
    },
  };
});
