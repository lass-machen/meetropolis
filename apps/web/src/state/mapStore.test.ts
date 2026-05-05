import { describe, it, expect, beforeEach } from 'vitest';
import { useMapStore } from './mapStore';

function reset(): void {
  // localStorage clearen, damit loadMapId() einen frischen Wert hat.
  try { window.localStorage.removeItem('meetropolis.map.currentMapId'); } catch {}
  useMapStore.setState({ currentMapId: '', currentMapName: '', availableMaps: [], isChangingMap: false });
}

describe('mapStore.setCurrentMap', () => {
  beforeEach(reset);

  it('setzt id + name regulaer', () => {
    useMapStore.getState().setCurrentMap('id-1', 'office');
    expect(useMapStore.getState().currentMapId).toBe('id-1');
    expect(useMapStore.getState().currentMapName).toBe('office');
  });

  it('ueberschreibt einen vorher gesetzten name NICHT mit leerem string', () => {
    useMapStore.getState().setCurrentMap('id-1', 'office');
    useMapStore.getState().setCurrentMap('', '');
    expect(useMapStore.getState().currentMapId).toBe('id-1');
    expect(useMapStore.getState().currentMapName).toBe('office');
  });

  it('akzeptiert neuen name, wenn vorher ohnehin leer', () => {
    useMapStore.getState().setCurrentMap('', '');
    expect(useMapStore.getState().currentMapName).toBe('');
    useMapStore.getState().setCurrentMap('id-2', 'lounge');
    expect(useMapStore.getState().currentMapName).toBe('lounge');
    expect(useMapStore.getState().currentMapId).toBe('id-2');
  });

  it('aktualisiert nur den nicht-leeren Teil bei partial-leerer Eingabe', () => {
    useMapStore.getState().setCurrentMap('id-1', 'office');
    // Nur name aktualisieren, id leer → existierende id behalten.
    useMapStore.getState().setCurrentMap('', 'lounge');
    expect(useMapStore.getState().currentMapName).toBe('lounge');
    expect(useMapStore.getState().currentMapId).toBe('id-1');
  });
});
