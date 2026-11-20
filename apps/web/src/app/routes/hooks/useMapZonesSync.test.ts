// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapZonesSync } from './useMapZonesSync';
import type { Zone } from '../../../services/EditorService';

const API_BASE = 'https://api.test';
const ME = { id: 'u1', email: 'u1@test' };
const OLD_ZONE: Zone = { name: 'old', points: [] };
const PLAZA_ZONE: Zone = {
  name: 'plaza',
  points: [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ],
};

type ZoneRef = Parameters<typeof useMapZonesSync>[0]['zoneRef'];

// A setEditor that behaves like the real reducer updater: it applies the
// functional update against an accumulating state object, so the test can
// assert on the final `zones` the hook wrote.
function makeSetEditor() {
  const state: { current: { zones: Zone[] } } = { current: { zones: [OLD_ZONE] } };
  const setEditor = vi.fn((updater: unknown) => {
    if (typeof updater === 'function') {
      state.current = (updater as (s: { zones: Zone[] }) => { zones: Zone[] })(state.current);
    }
  });
  return { setEditor, state };
}

function setup() {
  const { setEditor, state } = makeSetEditor();
  const setZones = vi.fn();
  const zoneRef = { current: { setZones } } as unknown as ZoneRef;
  renderHook(() => useMapZonesSync({ me: ME, apiBase: API_BASE, zoneRef, setEditor }));
  return { setEditor, state, setZones };
}

describe('useMapZonesSync — server_zones_loaded', () => {
  it('applies an empty zone list to the zone manager and the editor state', () => {
    const { setEditor, state, setZones } = setup();
    act(() => {
      window.dispatchEvent(new CustomEvent('server_zones_loaded', { detail: { zones: [] } }));
    });
    expect(setZones).toHaveBeenCalledWith([]);
    expect(setEditor).toHaveBeenCalled();
    expect(state.current.zones).toEqual([]);
  });

  it('applies a single zone to the zone manager and the editor state', () => {
    const { setEditor, state, setZones } = setup();
    act(() => {
      window.dispatchEvent(new CustomEvent('server_zones_loaded', { detail: { zones: [PLAZA_ZONE] } }));
    });
    expect(setZones).toHaveBeenCalledWith([PLAZA_ZONE]);
    expect(setEditor).toHaveBeenCalled();
    expect(state.current.zones).toEqual([PLAZA_ZONE]);
  });
});
