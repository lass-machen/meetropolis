import { describe, it, expect, beforeEach } from 'vitest';
import { useMapStore } from './mapStore';

function reset(): void {
  // localStorage clearen, damit loadMapId() einen frischen Wert hat.
  try {
    window.localStorage.removeItem('meetropolis.map.currentMapId');
  } catch {}
  useMapStore.setState({ currentMapId: '', currentMapName: '', availableMaps: [], isChangingMap: false });
}

describe('mapStore.setCurrentMap', () => {
  beforeEach(reset);

  it('sets id + name normally', () => {
    useMapStore.getState().setCurrentMap('id-1', 'office');
    expect(useMapStore.getState().currentMapId).toBe('id-1');
    expect(useMapStore.getState().currentMapName).toBe('office');
  });

  it('does NOT overwrite a previously set name with an empty string', () => {
    useMapStore.getState().setCurrentMap('id-1', 'office');
    useMapStore.getState().setCurrentMap('', '');
    expect(useMapStore.getState().currentMapId).toBe('id-1');
    expect(useMapStore.getState().currentMapName).toBe('office');
  });

  it('accepts a new name when previously empty anyway', () => {
    useMapStore.getState().setCurrentMap('', '');
    expect(useMapStore.getState().currentMapName).toBe('');
    useMapStore.getState().setCurrentMap('id-2', 'lounge');
    expect(useMapStore.getState().currentMapName).toBe('lounge');
    expect(useMapStore.getState().currentMapId).toBe('id-2');
  });

  it('updates only the non-empty part on partially empty input', () => {
    useMapStore.getState().setCurrentMap('id-1', 'office');
    // Nur name aktualisieren, id leer → existierende id behalten.
    useMapStore.getState().setCurrentMap('', 'lounge');
    expect(useMapStore.getState().currentMapName).toBe('lounge');
    expect(useMapStore.getState().currentMapId).toBe('id-1');
  });
});
