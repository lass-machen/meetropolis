// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchAndApplyServerLayers } from './serverSync';
import type { MainSceneLike } from '../types/scene';

// Minimal scene double: only the members that fetchAndApplyServerLayers
// touches on the tileset/spawn/zone path carry behaviour, the rest is inert.
function makeScene() {
  const setZoneOverlay = vi.fn();
  const scene = {
    currentMapId: 'map-1',
    mapRef: { width: 8, height: 8 },
    cameras: { main: { setBackgroundColor: vi.fn() } },
    setSpawnMarker: vi.fn(),
    setZoneOverlay,
    registerTileset: vi.fn(),
    terrainTilesetSources: new Map<string, string>(),
    dynamicTilesets: new Map(),
    waitForTilesetsReady: vi.fn().mockResolvedValue(undefined),
    ensureEditorLayers: vi.fn(),
    collisionVisible: false,
  } as unknown as MainSceneLike;
  return { scene, setZoneOverlay };
}

function stubEditorState(body: unknown) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as unknown as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('fetchAndApplyServerLayers — server_zones_loaded', () => {
  const received: Array<{ zones?: unknown }> = [];
  const handler = (e: Event) => {
    received.push((e as CustomEvent).detail as { zones?: unknown });
  };

  beforeEach(() => {
    received.length = 0;
    window.addEventListener('server_zones_loaded', handler);
  });

  afterEach(() => {
    window.removeEventListener('server_zones_loaded', handler);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('dispatches server_zones_loaded with an empty zone list', async () => {
    stubEditorState({ zones: [] });
    const { scene } = makeScene();
    await fetchAndApplyServerLayers(scene);
    expect(received).toHaveLength(1);
    expect(received[0]?.zones).toEqual([]);
  });

  it('dispatches server_zones_loaded with a single zone', async () => {
    const zones = [
      {
        name: 'plaza',
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
        ],
      },
    ];
    stubEditorState({ zones });
    const { scene, setZoneOverlay } = makeScene();
    await fetchAndApplyServerLayers(scene);
    expect(received).toHaveLength(1);
    expect(received[0]?.zones).toHaveLength(1);
    expect(setZoneOverlay).toHaveBeenCalledTimes(1);
  });
});
