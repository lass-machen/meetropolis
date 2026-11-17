import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MainSceneLike } from '../types/scene';
import { registerTileset } from './tilesets';
import { loadMemberImage } from '../services/assetLoader';

vi.mock('../../lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../services/assetLoader', () => ({
  loadMemberImage: vi.fn(),
  loadMemberSpritesheet: vi.fn(),
}));

const loadMemberImageMock = vi.mocked(loadMemberImage);

/**
 * Minimal MainSceneLike fake for registerTileset. The `addtexture` listener
 * registered by registerTileset is captured but never fired here: with the
 * helper mocked, no loader event can arrive, so the tests below only assert
 * the load path taken (helper vs. direct scene.load).
 */
function makeScene() {
  const scene = {
    mapRef: { tilesets: [] as Array<{ name: string }> },
    game: { renderer: {} },
    dynamicTilesets: new Map(),
    textures: {
      exists: vi.fn(() => false),
      once: vi.fn((_event: string, _fn: (key: string) => void) => {}),
      addBase64: vi.fn(),
    },
    load: {
      image: vi.fn((_key: string, _url: string) => {}),
      setCORS: vi.fn((_value: string) => {}),
      start: vi.fn(() => {}),
    },
  };
  return { scene: scene as unknown as MainSceneLike, load: scene.load, textures: scene.textures };
}

describe('registerTileset (member assets)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMemberImageMock.mockReset();
    loadMemberImageMock.mockResolvedValue(undefined);
  });

  it('loads a /packs tileset through loadMemberImage, not scene.load', async () => {
    const { scene, load } = makeScene();
    registerTileset(scene, {
      key: 'ts-a',
      dataUrl: '/packs/tilesets/a.png',
      tileWidth: 16,
      tileHeight: 16,
      margin: 0,
      spacing: 0,
    });
    await vi.waitFor(() => expect(loadMemberImageMock).toHaveBeenCalledWith(scene, 'ts-a', '/packs/tilesets/a.png'));
    expect(load.image).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/packs/'));
    expect(load.setCORS).not.toHaveBeenCalled();
  });

  it('keeps data: urls on the addBase64 path without the helper', async () => {
    const { scene, textures } = makeScene();
    registerTileset(scene, {
      key: 'ts-inline',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      tileWidth: 16,
      tileHeight: 16,
      margin: 0,
      spacing: 0,
    });
    await Promise.resolve();
    expect(textures.addBase64).toHaveBeenCalledWith('ts-inline', 'data:image/png;base64,iVBORw0KGgo=');
    expect(loadMemberImageMock).not.toHaveBeenCalled();
  });
});
