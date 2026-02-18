import { create } from 'zustand';

interface MapState {
  currentMapName: string;
  availableMaps: Array<{ name: string }>;
  isChangingMap: boolean;
  setCurrentMapName: (name: string) => void;
  setAvailableMaps: (maps: Array<{ name: string }>) => void;
  setIsChangingMap: (changing: boolean) => void;
}

export const useMapStore = create<MapState>((set) => ({
  currentMapName: 'office',
  availableMaps: [],
  isChangingMap: false,
  setCurrentMapName: (name) => set({ currentMapName: name }),
  setAvailableMaps: (maps) => set({ availableMaps: maps }),
  setIsChangingMap: (changing) => set({ isChangingMap: changing }),
}));
