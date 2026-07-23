import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./runtimeConfig', () => ({
  getApiBaseFromWindow: () => 'http://api.test',
}));

import { preloadTilesetImages, type V2Tileset } from './mapV2';
import { logger } from './logger';

type Handler = (...args: unknown[]) => void;

/**
 * Minimal fake of the Phaser loader/texture surface used by
 * preloadTilesetImages. `start()` synchronously emits `loaderror` for every
 * queued key in `failKeys`, marks the rest as existing textures, and then
 * fires the `complete` handlers, mirroring the Phaser loader contract where
 * `complete` fires even when individual files failed.
 */
function makeFakeScene(opts: { existing?: string[]; failKeys?: string[]; createCanvasThrows?: boolean } = {}) {
  const existing = new Set(opts.existing ?? []);
  const failKeys = new Set(opts.failKeys ?? []);
  const queued: Array<{ key: string; url: string }> = [];
  const onHandlers: Record<string, Handler[]> = {};
  const onceHandlers: Record<string, Handler[]> = {};
  const createdPlaceholders: string[] = [];

  const scene = {
    load: {
      image: (key: string, url: string) => {
        queued.push({ key, url });
      },
      on: (event: string, fn: Handler) => {
        (onHandlers[event] ??= []).push(fn);
      },
      once: (event: string, fn: Handler) => {
        (onceHandlers[event] ??= []).push(fn);
      },
      off: (event: string, fn: Handler) => {
        onHandlers[event] = (onHandlers[event] ?? []).filter((h) => h !== fn);
        onceHandlers[event] = (onceHandlers[event] ?? []).filter((h) => h !== fn);
      },
      start: () => {
        for (const q of queued) {
          if (failKeys.has(q.key)) {
            for (const h of [...(onHandlers['loaderror'] ?? [])]) h({ key: q.key });
          } else {
            existing.add(q.key);
          }
        }
        const completes = [...(onceHandlers['complete'] ?? [])];
        onceHandlers['complete'] = [];
        for (const h of completes) h();
      },
    },
    textures: {
      exists: (key: string) => existing.has(key),
      createCanvas: vi.fn((key: string) => {
        if (opts.createCanvasThrows) throw new Error('no canvas support');
        createdPlaceholders.push(key);
        existing.add(key);
        return { context: { fillStyle: '', fillRect: vi.fn() }, refresh: vi.fn() };
      }),
    },
  };

  return {
    scene: scene as unknown as Phaser.Scene,
    queued,
    createdPlaceholders,
    existing,
  };
}

function makeTileset(key: string, slot: number): V2Tileset {
  return { id: `id-${key}`, slot, key, imageUrl: `/packs/${key}.png`, tileWidth: 16, tileHeight: 16 };
}

describe('preloadTilesetImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads all missing tileset images and resolves', async () => {
    const { scene, queued, createdPlaceholders, existing } = makeFakeScene();
    await preloadTilesetImages(scene, [makeTileset('a', 0), makeTileset('b', 1)]);
    expect(queued.map((q) => q.key)).toEqual(['a', 'b']);
    expect(existing.has('a')).toBe(true);
    expect(existing.has('b')).toBe(true);
    expect(createdPlaceholders).toEqual([]);
  });

  it('resolves relative image urls against the api base', async () => {
    const { scene, queued } = makeFakeScene();
    await preloadTilesetImages(scene, [makeTileset('a', 0)]);
    expect(queued[0]?.url).toBe('http://api.test/packs/a.png');
  });

  it('skips tilesets whose textures already exist', async () => {
    const { scene, queued } = makeFakeScene({ existing: ['a'] });
    await preloadTilesetImages(scene, [makeTileset('a', 0), makeTileset('b', 1)]);
    expect(queued.map((q) => q.key)).toEqual(['b']);
  });

  it('is a no-op when every texture already exists', async () => {
    const { scene, queued } = makeFakeScene({ existing: ['a', 'b'] });
    await preloadTilesetImages(scene, [makeTileset('a', 0), makeTileset('b', 1)]);
    expect(queued).toEqual([]);
  });

  it('continues past a failing image and installs a placeholder texture', async () => {
    const { scene, createdPlaceholders, existing } = makeFakeScene({ failKeys: ['broken'] });
    await preloadTilesetImages(scene, [makeTileset('a', 0), makeTileset('broken', 1), makeTileset('b', 2)]);
    expect(existing.has('a')).toBe(true);
    expect(existing.has('b')).toBe(true);
    expect(createdPlaceholders).toEqual(['broken']);
    expect(existing.has('broken')).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('broken'));
  });

  it('does not refetch a failed image on the next run once the placeholder exists', async () => {
    const { scene, queued } = makeFakeScene({ failKeys: ['broken'] });
    await preloadTilesetImages(scene, [makeTileset('broken', 0)]);
    const queuedAfterFirstRun = queued.length;
    await preloadTilesetImages(scene, [makeTileset('broken', 0)]);
    expect(queued.length).toBe(queuedAfterFirstRun);
  });

  it('ignores loaderror events for keys outside the current batch', async () => {
    const { scene, createdPlaceholders } = makeFakeScene({ failKeys: [] });
    const sceneLoad = (scene as unknown as { load: { on: (ev: string, fn: Handler) => void } }).load;
    const originalOn = sceneLoad.on.bind(sceneLoad);
    sceneLoad.on = (event: string, fn: Handler) => {
      originalOn(event, fn);
      if (event === 'loaderror') fn({ key: 'unrelated' });
    };
    await preloadTilesetImages(scene, [makeTileset('a', 0)]);
    expect(createdPlaceholders).toEqual([]);
  });

  it('still resolves when placeholder creation fails', async () => {
    const { scene } = makeFakeScene({ failKeys: ['broken'], createCanvasThrows: true });
    await expect(preloadTilesetImages(scene, [makeTileset('broken', 0)])).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('broken'), expect.any(Error));
  });
});
