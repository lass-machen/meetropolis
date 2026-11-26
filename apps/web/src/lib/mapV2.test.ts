import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./runtimeConfig', () => ({
  getApiBaseFromWindow: () => 'http://api.test',
}));

vi.mock('../game/services/assetLoader', () => ({
  loadMemberImage: vi.fn(),
  loadMemberSpritesheet: vi.fn(),
}));

import { preloadTilesetImages, type V2Tileset } from './mapV2';
import { logger } from './logger';
import { loadMemberImage } from '../game/services/assetLoader';

const loadMemberImageMock = vi.mocked(loadMemberImage);

/**
 * Minimal fake of the texture surface used by preloadTilesetImages. The
 * Phaser loader itself is intentionally absent: every image must travel
 * through the loadMemberImage helper (mocked above), so any direct
 * `scene.load.image` call would throw here instead of loading.
 */
function makeFakeScene(opts: { existing?: string[]; failKeys?: string[]; createCanvasThrows?: boolean } = {}) {
  const existing = new Set(opts.existing ?? []);
  const failKeys = new Set(opts.failKeys ?? []);
  const calls: Array<{ key: string; ref: string }> = [];
  const createdPlaceholders: string[] = [];
  loadMemberImageMock.mockImplementation((_scene: unknown, key: string, ref: string) => {
    calls.push({ key, ref });
    if (failKeys.has(key)) return Promise.reject(new Error(`member load failed for ${key}`));
    existing.add(key);
    return Promise.resolve();
  });

  const scene = {
    load: {
      image: vi.fn((_key: string, _url: string) => {
        throw new Error('direct scene.load.image is forbidden for tileset images');
      }),
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      start: vi.fn(),
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
    calls,
    createdPlaceholders,
    existing,
  };
}

function makeTileset(key: string, slot: number, imageUrl?: string): V2Tileset {
  return { id: `id-${key}`, slot, key, imageUrl: imageUrl ?? `/packs/${key}.png`, tileWidth: 16, tileHeight: 16 };
}

describe('preloadTilesetImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMemberImageMock.mockReset();
  });

  it('loads all missing tileset images through loadMemberImage and resolves', async () => {
    const { scene, calls, createdPlaceholders, existing } = makeFakeScene();
    await preloadTilesetImages(scene, [makeTileset('a', 0), makeTileset('b', 1)]);
    expect(calls.map((c) => c.key)).toEqual(['a', 'b']);
    expect(existing.has('a')).toBe(true);
    expect(existing.has('b')).toBe(true);
    expect(createdPlaceholders).toEqual([]);
  });

  it('resolves relative image urls against the api base', async () => {
    const { scene, calls } = makeFakeScene();
    await preloadTilesetImages(scene, [makeTileset('a', 0)]);
    expect(calls[0]?.ref).toBe('http://api.test/packs/a.png');
  });

  it('passes absolute member urls to the helper unchanged', async () => {
    const { scene, calls } = makeFakeScene();
    await preloadTilesetImages(scene, [makeTileset('a', 0, 'http://api.test/packs/a.png')]);
    expect(calls[0]?.ref).toBe('http://api.test/packs/a.png');
  });

  it('never loads a /packs ref through scene.load.image directly', async () => {
    const { scene } = makeFakeScene();
    const loadImage = (scene as unknown as { load: { image: ReturnType<typeof vi.fn> } }).load.image;
    await preloadTilesetImages(scene, [makeTileset('a', 0)]);
    expect(loadImage).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/packs/'));
  });

  it('skips tilesets whose textures already exist', async () => {
    const { scene, calls } = makeFakeScene({ existing: ['a'] });
    await preloadTilesetImages(scene, [makeTileset('a', 0), makeTileset('b', 1)]);
    expect(calls.map((c) => c.key)).toEqual(['b']);
  });

  it('is a no-op when every texture already exists', async () => {
    const { scene, calls } = makeFakeScene({ existing: ['a', 'b'] });
    await preloadTilesetImages(scene, [makeTileset('a', 0), makeTileset('b', 1)]);
    expect(calls).toEqual([]);
  });

  it('continues past a failing image and installs a placeholder texture', async () => {
    const { scene, createdPlaceholders, existing } = makeFakeScene({ failKeys: ['broken'] });
    await expect(
      preloadTilesetImages(scene, [makeTileset('a', 0), makeTileset('broken', 1), makeTileset('b', 2)]),
    ).resolves.toBeUndefined();
    expect(existing.has('a')).toBe(true);
    expect(existing.has('b')).toBe(true);
    expect(createdPlaceholders).toEqual(['broken']);
    expect(existing.has('broken')).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('broken'));
  });

  it('does not refetch a failed image on the next run once the placeholder exists', async () => {
    const { scene, calls } = makeFakeScene({ failKeys: ['broken'] });
    await preloadTilesetImages(scene, [makeTileset('broken', 0)]);
    const callsAfterFirstRun = calls.length;
    await preloadTilesetImages(scene, [makeTileset('broken', 0)]);
    expect(calls.length).toBe(callsAfterFirstRun);
  });

  it('still resolves when placeholder creation fails', async () => {
    const { scene } = makeFakeScene({ failKeys: ['broken'], createCanvasThrows: true });
    await expect(preloadTilesetImages(scene, [makeTileset('broken', 0)])).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('broken'), expect.any(Error));
  });
});
