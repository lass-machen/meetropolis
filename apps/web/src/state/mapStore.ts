import { create } from 'zustand';

const STORAGE_KEY = 'meetropolis.map.currentMapId';

function loadMapId(): string {
  try {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function saveMapId(id: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {}
}

interface MapState {
  currentMapId: string;
  currentMapName: string;
  availableMaps: Array<{ id: string; name: string }>;
  isChangingMap: boolean;
  setCurrentMap: (id: string, name: string) => void;
  setCurrentMapName: (name: string) => void;
  setAvailableMaps: (maps: Array<{ id: string; name: string }>) => void;
  setIsChangingMap: (changing: boolean) => void;
}

export const useMapStore = create<MapState>((set, get) => ({
  currentMapId: loadMapId(),
  currentMapName: '',
  availableMaps: [],
  isChangingMap: false,
  setCurrentMap: (id, name) => {
    saveMapId(id);
    set({ currentMapId: id, currentMapName: name });
  },
  setCurrentMapName: (name) => {
    const { availableMaps } = get();
    const found = availableMaps.find(m => m.name === name);
    if (found) {
      saveMapId(found.id);
      set({ currentMapId: found.id, currentMapName: name });
    } else {
      set({ currentMapName: name });
    }
  },
  setAvailableMaps: (maps) => {
    const state = get();
    const updates: Partial<MapState> = { availableMaps: maps };
    // Resolve name from ID if currentMapName is empty but we have an ID
    if (state.currentMapId && !state.currentMapName) {
      const found = maps.find(m => m.id === state.currentMapId);
      if (found) updates.currentMapName = found.name;
    }
    // Resolve currentMapName to ID if we have a name but no ID yet
    if (!state.currentMapId && state.currentMapName) {
      const found = maps.find(m => m.name === state.currentMapName);
      if (found) {
        updates.currentMapId = found.id;
        updates.currentMapName = found.name;
        saveMapId(found.id);
      }
    }
    // If we have no ID yet, pick the first map as default
    if (!state.currentMapId && !updates.currentMapId && maps.length > 0) {
      updates.currentMapId = maps[0].id;
      updates.currentMapName = maps[0].name;
      saveMapId(maps[0].id);
    }
    set(updates);
  },
  setIsChangingMap: (changing) => set({ isChangingMap: changing }),
}));
