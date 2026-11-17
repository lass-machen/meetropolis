import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectManager, type MapObjectData, type ObjectManagerConfig } from './objectManager';
import { loadMemberImage } from '../../services/assetLoader';

vi.mock('../../../lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/runtimeConfig', () => ({
  getApiBaseFromWindow: () => 'http://api.test',
}));

vi.mock('../../services/assetLoader', () => ({
  loadMemberImage: vi.fn(),
  loadMemberSpritesheet: vi.fn(),
}));

const loadMemberImageMock = vi.mocked(loadMemberImage);

function makeObject(overrides?: Partial<MapObjectData>): MapObjectData {
  return {
    id: 7,
    mapId: 'm1',
    assetPackUuid: 'pack-1',
    itemId: 'chair',
    category: 'furniture',
    tileX: 3,
    tileY: 4,
    chunkX: 0,
    chunkY: 0,
    width: 1,
    height: 1,
    collide: false,
    zIndex: 0,
    rotation: 0,
    flipX: false,
    flipY: false,
    scaleFactor: 1,
    dataUrl: '/packs/objects/chair.png',
    ...overrides,
  };
}

function makeSprite() {
  return {
    y: 64,
    displayHeight: 16,
    setOrigin: vi.fn(),
    setRotation: vi.fn(),
    setFlip: vi.fn(),
    setScale: vi.fn(),
    setDepth: vi.fn(),
    setVisible: vi.fn(),
    setPosition: vi.fn(),
    destroy: vi.fn(),
  };
}

/**
 * Minimal scene fake for ObjectManager. The loader surface only records
 * calls: every texture must travel through the loadMemberImage helper
 * (mocked above), so any direct `scene.load.image` with a /packs URL is
 * asserted absent instead of executed.
 */
function makeManager() {
  const existing = new Set<string>();
  loadMemberImageMock.mockImplementation((_scene: unknown, key: string, _ref: string) => {
    existing.add(key);
    return Promise.resolve();
  });
  const sprite = makeSprite();
  const scene = {
    mapRef: { tileWidth: 16, tileHeight: 16 },
    currentMapId: 'm1',
    textures: { exists: (key: string) => existing.has(key) },
    load: {
      setCORS: vi.fn((_value: string) => {}),
      image: vi.fn((_key: string, _url: string) => {}),
      once: vi.fn((_event: string, _fn: () => void) => {}),
      start: vi.fn(() => {}),
    },
    add: { image: vi.fn((_x: number, _y: number, _key: string) => sprite) },
  };
  const manager = new ObjectManager({ scene: scene as unknown as ObjectManagerConfig['scene'] });
  return { scene, manager, sprite };
}

describe('ObjectManager (member assets)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMemberImageMock.mockReset();
  });

  it('loads a /packs object texture through loadMemberImage, not scene.load', async () => {
    const { scene, manager } = makeManager();
    manager.addObject(makeObject());
    await vi.waitFor(() =>
      expect(loadMemberImageMock).toHaveBeenCalledWith(scene, 'mapobj_7', 'http://api.test/packs/objects/chair.png'),
    );
    expect(scene.load.image).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/packs/'));
    expect(scene.load.setCORS).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(scene.add.image).toHaveBeenCalledWith(48, 64, 'mapobj_7'));
  });

  it('deduplicates concurrent loads for the same texture key', async () => {
    const { scene, manager } = makeManager();
    const obj = makeObject();
    manager.addObject(obj);
    manager.addObject({ ...obj });
    await vi.waitFor(() => expect(scene.add.image).toHaveBeenCalledTimes(1));
    expect(loadMemberImageMock).toHaveBeenCalledTimes(1);
  });

  it('creates no sprite when the member load fails', async () => {
    const { scene, manager } = makeManager();
    loadMemberImageMock.mockRejectedValueOnce(new Error('forbidden'));
    manager.addObject(makeObject());
    await vi.waitFor(() => expect(loadMemberImageMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scene.add.image).not.toHaveBeenCalled();
  });
});
