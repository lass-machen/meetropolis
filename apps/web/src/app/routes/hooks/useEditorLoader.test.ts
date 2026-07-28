// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// The editor loader pulls in the Phaser bridge, the editor service and the
// asset-registry helpers purely for their side effects. None of that is under
// test here — the target is the DATA path (which map-scoped requests fire and
// when) — so the side-effect modules are stubbed to keep the hook inert and
// deterministic under jsdom.
vi.mock('../../../game/bridge', () => ({
  gameBridge: {
    fetchAndApplyServerLayers: vi.fn(),
    reloadEditorLayers: vi.fn(),
    registerTileset: vi.fn(),
    registerAutotiles: vi.fn(),
    setZoneOverlay: vi.fn(),
    setBackgroundColor: vi.fn(),
    setSpawnMarker: vi.fn(),
  },
}));
vi.mock('../../../services/EditorService', () => ({
  EditorService: { dispatch: vi.fn() },
}));
vi.mock('../../../lib/directionalImageRegistry', () => ({
  loadFromPacks: vi.fn(),
}));
vi.mock('../../../lib/tilesetUtils', () => ({
  splitTilesetImage: vi.fn().mockResolvedValue([]),
}));

import { useEditorLoader } from './useEditorLoader';
import { useMapStore } from '../../../state/mapStore';

const API_BASE = 'https://api.test';
const ME = { id: 'u1', email: 'u1@test' };

// A single placed object, shaped like the /maps/{id}/objects payload that the
// editor loader derives its `assets` from.
const OBJECTS = [
  {
    id: 'obj-1',
    assetPackUuid: 'pixel-agents-furniture',
    itemId: 'chair',
    dataUrl: '/packs/pixel-agents-furniture/chair.png',
    tileX: 3,
    tileY: 4,
    category: 'objects',
    collide: true,
    width: 16,
    height: 16,
    rotation: 0,
    scaleFactor: 1,
  },
];

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

// Routes each request the loader issues to a canned response. The
// `/maps/{id}/objects` branch (no `?chunks=` query) is the editor-loader path
// whose absence is the bug under test.
// The loader always calls fetch with a string URL, so the mock types its input
// as `string` (which also keeps eslint's no-base-to-string rule satisfied).
function makeFetch(objects: unknown[] = OBJECTS) {
  return vi.fn((url: string) => {
    if (url.endsWith('/asset-packs')) return Promise.resolve(jsonResponse(200, []));
    if (url.includes('/editor-state')) return Promise.resolve(jsonResponse(200, {}));
    if (url.endsWith('/objects')) return Promise.resolve(jsonResponse(200, objects));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function objectRequests(fetchMock: ReturnType<typeof makeFetch>): string[] {
  return fetchMock.mock.calls.map((c) => c[0]).filter((u) => u.includes('/maps/') && u.endsWith('/objects'));
}

// A setEditor that behaves like the real reducer updater: it applies the
// functional update against an accumulating state object, so the test can
// assert on the final `assets` the loader wrote.
function makeSetEditor() {
  const state: { current: Record<string, unknown> } = { current: {} };
  const setEditor = vi.fn((updater: unknown) => {
    if (typeof updater === 'function') {
      state.current = (updater as (s: unknown) => Record<string, unknown>)(state.current);
    }
  });
  return { setEditor, state };
}

function resetMapStore(): void {
  try {
    window.localStorage.removeItem('meetropolis.map.currentMapId');
  } catch {}
  useMapStore.setState({ currentMapId: '', currentMapName: '', availableMaps: [], isChangingMap: false });
}

describe('useEditorLoader — map-object load race (me before currentMapId)', () => {
  beforeEach(() => {
    resetMapStore();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('loads map objects once currentMapId resolves, even though me arrived first', async () => {
    const fetchMock = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { setEditor, state } = makeSetEditor();

    // 1. Boot with no user yet: nothing should load.
    const { rerender } = renderHook(
      (props: { me: typeof ME | null }) => useEditorLoader({ ...props, apiBase: API_BASE, setEditor }),
      {
        initialProps: { me: null as typeof ME | null },
      },
    );
    expect(objectRequests(fetchMock)).toHaveLength(0);

    // 2. The user signs in while the map store has NOT resolved a map id yet
    //    (currentMapId === ''). This is the exact ordering that used to wedge
    //    the loader: the map-object request must NOT fire yet...
    act(() => {
      rerender({ me: ME });
    });
    // Give any map-independent async work (asset packs) a chance to run.
    await Promise.resolve();
    await Promise.resolve();
    expect(objectRequests(fetchMock)).toHaveLength(0);

    // 3. The map store now resolves the active map — AFTER me. The loader must
    //    react and fetch the objects for that map.
    act(() => {
      useMapStore.setState({ currentMapId: 'map-1' });
    });

    await waitFor(() => {
      expect(objectRequests(fetchMock)).toEqual([`${API_BASE}/maps/map-1/objects`]);
    });

    // The derived editor assets must be populated from the fetched objects —
    // this is what makes the placed sprites visible in the editor.
    await waitFor(() => {
      const assets = state.current.assets as Array<{ id: string }> | undefined;
      expect(assets).toBeDefined();
      expect(assets).toHaveLength(1);
      expect(assets?.[0].id).toBe('obj-1');
    });

    // A redundant re-render with the same map id must not refetch (no
    // double-fetch per resolved map).
    act(() => {
      rerender({ me: ME });
    });
    await Promise.resolve();
    expect(objectRequests(fetchMock)).toHaveLength(1);
  });

  it('reloads objects when the active map changes to a different id', async () => {
    const fetchMock = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { setEditor } = makeSetEditor();

    renderHook(() => useEditorLoader({ me: ME, apiBase: API_BASE, setEditor }));

    act(() => {
      useMapStore.setState({ currentMapId: 'map-1' });
    });
    await waitFor(() => {
      expect(objectRequests(fetchMock)).toEqual([`${API_BASE}/maps/map-1/objects`]);
    });

    // Switching maps must load the new map's objects (documented behaviour:
    // the editor follows the active map).
    act(() => {
      useMapStore.setState({ currentMapId: 'map-2' });
    });
    await waitFor(() => {
      expect(objectRequests(fetchMock)).toEqual([`${API_BASE}/maps/map-1/objects`, `${API_BASE}/maps/map-2/objects`]);
    });
  });
});
