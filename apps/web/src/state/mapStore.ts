import { create } from 'zustand';

const STORAGE_KEY = 'meetropolis.map.currentMapName';

function loadMapName(): string {
  try {
    if (typeof window === 'undefined') return 'office';
    return window.localStorage.getItem(STORAGE_KEY) || 'office';
  } catch {
    return 'office';
  }
}

function saveMapName(name: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, name);
  } catch {}
}

interface MapState {
  currentMapName: string;
  availableMaps: Array<{ name: string }>;
  isChangingMap: boolean;
  setCurrentMapName: (name: string) => void;
  setAvailableMaps: (maps: Array<{ name: string }>) => void;
  setIsChangingMap: (changing: boolean) => void;
}

export const useMapStore = create<MapState>((set) => ({
  currentMapName: loadMapName(),
  availableMaps: [],
  isChangingMap: false,
  setCurrentMapName: (name) => {
    saveMapName(name);
    set({ currentMapName: name });
  },
  setAvailableMaps: (maps) => set({ availableMaps: maps }),
  setIsChangingMap: (changing) => set({ isChangingMap: changing }),
}));
