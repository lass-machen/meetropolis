import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/mapV2', () => ({
  fetchChunks: vi.fn(),
  decodeRLE: vi.fn((_data: string, total: number) => new Array<number>(total).fill(0)),
  tileRefIdToGid: vi.fn(() => -1),
}));

import { loadVisibleChunks } from './chunks';
import { fetchChunks } from '../../lib/mapV2';
import { logger } from '../../lib/logger';
import type { MainSceneLike } from '../types/scene';

const fetchChunksMock = vi.mocked(fetchChunks);

/**
 * Viewport fixture: tile size 16, chunk size 2, camera covering tiles 0..4
 * horizontally and 0..1 vertically, i.e. the chunk keys 0:0, 1:0 and 2:0.
 */
function makeScene(): MainSceneLike {
  const layer = { putTileAt: vi.fn(), removeTileAt: vi.fn() };
  return {
    v2: { state: {}, firstGids: [], chunkSize: 2 },
    mapRef: { width: 8, height: 2, tileWidth: 16, tileHeight: 16 },
    cameras: { main: { worldView: { x: 0, y: 0, width: 64, height: 16 }, zoom: 1 } },
    loadedChunks: new Set<string>(),
    currentMapId: 'map-1',
    editorGround: layer,
    ensureCollisionCollider: vi.fn(),
    rebuildStaticColliders: vi.fn(),
  } as unknown as MainSceneLike;
}

const chunkPayload = { version: 1, encoding: 'rle', data: '' };

describe('loadVisibleChunks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchChunksMock.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requests visible chunks and marks returned chunks as loaded', async () => {
    const scene = makeScene();
    fetchChunksMock.mockResolvedValue({ '0:0': chunkPayload });
    await loadVisibleChunks(scene, 'ground');
    expect(fetchChunksMock).toHaveBeenCalledTimes(1);
    expect(fetchChunksMock).toHaveBeenCalledWith('map-1', 'ground', ['0:0', '1:0', '2:0']);
    expect(scene.loadedChunks.has('ground:0:0')).toBe(true);
  });

  it('marks chunks omitted from the response as loaded to stop refetch loops', async () => {
    const scene = makeScene();
    fetchChunksMock.mockResolvedValue({ '0:0': chunkPayload });
    await loadVisibleChunks(scene, 'ground');
    expect(scene.loadedChunks.has('ground:1:0')).toBe(true);
    expect(scene.loadedChunks.has('ground:2:0')).toBe(true);

    await loadVisibleChunks(scene, 'ground');
    expect(fetchChunksMock).toHaveBeenCalledTimes(1);
  });

  it('applies backoff after a failed fetch before retrying the same keys', async () => {
    const scene = makeScene();
    fetchChunksMock.mockRejectedValue(new Error('network down'));
    await loadVisibleChunks(scene, 'ground');
    expect(fetchChunksMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();

    await loadVisibleChunks(scene, 'ground');
    expect(fetchChunksMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    await loadVisibleChunks(scene, 'ground');
    expect(fetchChunksMock).toHaveBeenCalledTimes(2);
  });

  it('recovers when a retry succeeds after failures', async () => {
    const scene = makeScene();
    fetchChunksMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValue({});
    await loadVisibleChunks(scene, 'ground');
    vi.advanceTimersByTime(1_000);
    await loadVisibleChunks(scene, 'ground');
    expect(fetchChunksMock).toHaveBeenCalledTimes(2);
    expect(scene.loadedChunks.has('ground:0:0')).toBe(true);

    await loadVisibleChunks(scene, 'ground');
    expect(fetchChunksMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget is exhausted and stops requesting', async () => {
    const scene = makeScene();
    fetchChunksMock.mockRejectedValue(new Error('server gone'));
    for (let i = 0; i < 8; i++) {
      await loadVisibleChunks(scene, 'ground');
      vi.advanceTimersByTime(30_000);
    }
    expect(fetchChunksMock).toHaveBeenCalledTimes(8);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Giving up'), expect.any(Error));

    vi.advanceTimersByTime(120_000);
    await loadVisibleChunks(scene, 'ground');
    expect(fetchChunksMock).toHaveBeenCalledTimes(8);
  });

  it('tracks retry state per layer', async () => {
    const scene = makeScene();
    fetchChunksMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValue({});
    await loadVisibleChunks(scene, 'ground');
    // ground is now in backoff; walls must still be fetched immediately.
    await loadVisibleChunks(scene, 'walls');
    expect(fetchChunksMock).toHaveBeenCalledTimes(2);
    expect(fetchChunksMock).toHaveBeenLastCalledWith('map-1', 'walls', ['0:0', '1:0', '2:0']);
  });
});
