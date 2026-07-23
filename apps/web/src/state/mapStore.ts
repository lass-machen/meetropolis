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
    // Guard against race resets: an empty name must not overwrite a previously
    // set, correct value (e.g. when the server returns a player with an empty
    // mapName during a DB race).
    const prev = get();
    const nextName = name === '' && prev.currentMapName !== '' ? prev.currentMapName : name;
    const nextId = id === '' && prev.currentMapId !== '' ? prev.currentMapId : id;
    if (nextId) saveMapId(nextId);
    set({ currentMapId: nextId, currentMapName: nextName });
  },
  setCurrentMapName: (name) => {
    const { availableMaps } = get();
    const found = availableMaps.find((m) => m.name === name);
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
    // `maps` is the authoritative list of the ACTIVE tenant's maps. A
    // currentMapId that is not in it is invalid for this tenant: it is
    // typically a value persisted in localStorage from a previous tenant
    // (the storage key is global). Using it makes every map request 404 and
    // the world never boots, so treat it as absent and reconcile below.
    const idValid = state.currentMapId !== '' && maps.some((m) => m.id === state.currentMapId);

    // Resolve name from a valid ID when the name is missing.
    if (idValid && !state.currentMapName) {
      const found = maps.find((m) => m.id === state.currentMapId);
      if (found) updates.currentMapName = found.name;
    }

    // No valid ID: fall back to the map matching the known name, else the
    // tenant's first map. This heals both a fresh boot (no ID yet) and a
    // stale/cross-tenant persisted ID.
    if (!idValid && maps.length > 0) {
      const byName = state.currentMapName ? maps.find((m) => m.name === state.currentMapName) : undefined;
      const chosen = byName ?? maps[0];
      updates.currentMapId = chosen.id;
      updates.currentMapName = chosen.name;
      saveMapId(chosen.id);
    }
    set(updates);
  },
  setIsChangingMap: (changing) => set({ isChangingMap: changing }),
}));
