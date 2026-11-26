// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import type { V2Autotile } from '../../lib/mapV2';
import { logger } from '../../lib/logger';
import { loadMemberImageElement } from '../../lib/memberImage';
import { AutotileTextureLoader, autotileTextureKey } from './AutotileTextureLoader';

vi.mock('../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/memberImage', () => ({ loadMemberImageElement: vi.fn() }));

const loadMemberImageElementMock = vi.mocked(loadMemberImageElement);

class DirectImageForbidden {
  constructor() {
    throw new Error('direct Image construction is forbidden for protected files');
  }
}

type PendingLoad = {
  resolve: (value: { image: HTMLImageElement; release: () => void }) => void;
  reject: (reason: unknown) => void;
};
const pending: PendingLoad[] = [];

function autotile(overrides: Partial<V2Autotile> = {}): V2Autotile {
  return {
    slot: 3,
    packUuid: 'pack-one',
    autotileId: 'wall-one',
    key: 'Wall',
    imageUrl: '/packs/pack-one/wall.1234abcd.png',
    tileWidth: 16,
    tileHeight: 48,
    gridHeight: 3,
    variants: { '0': { col: 0, row: 0 }, '2': { col: 1, row: 0 } },
    collide: true,
    placement: 'wall',
    hash: '1234abcd',
    ...overrides,
  };
}

function harness() {
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
  const canvasTexture = { context, refresh: vi.fn() };
  const textures = {
    exists: vi.fn().mockReturnValue(false),
    addSpriteSheet: vi.fn(),
    createCanvas: vi.fn().mockReturnValue(canvasTexture),
  };
  const renderer = { registerDefinition: vi.fn(), updateAllVisible: vi.fn() };
  const scene = { textures, currentMapId: 'map-one', autotileRenderer: renderer };
  return {
    context,
    canvasTexture,
    textures,
    renderer,
    scene,
    loader: new AutotileTextureLoader(scene, 'map-one', renderer),
  };
}

function succeed(index: number): void {
  pending[index].resolve({ image: {} as HTMLImageElement, release: () => {} });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  pending.length = 0;
  vi.stubGlobal('Image', DirectImageForbidden);
  vi.clearAllMocks();
  loadMemberImageElementMock.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autotile texture snapshots', () => {
  it('isolates texture keys by map, slot, and snapshot hash', () => {
    const item = autotile();

    expect(autotileTextureKey('map-one', item)).not.toBe(autotileTextureKey('map-two', item));
    expect(autotileTextureKey('map-one', item)).not.toBe(autotileTextureKey('map-one', { ...item, slot: 4 }));
    expect(autotileTextureKey('map-one', item)).not.toBe(autotileTextureKey('map-one', { ...item, hash: 'ffffffff' }));
  });

  it('loads the stored snapshot through loadMemberImageElement, not new Image()', async () => {
    const { loader, textures } = harness();
    loader.register([autotile()]);

    expect(loadMemberImageElementMock).toHaveBeenCalledTimes(1);
    expect(loadMemberImageElementMock).toHaveBeenCalledWith(
      expect.stringContaining('/packs/pack-one/wall.1234abcd.png'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    succeed(0);
    await flush();

    expect(textures.addSpriteSheet).toHaveBeenCalledTimes(1);
  });

  it('drops an image callback after the map renderer is destroyed', async () => {
    const { loader, textures, renderer } = harness();
    loader.register([autotile()]);

    loader.destroy();
    succeed(0);
    await flush();

    expect(textures.addSpriteSheet).not.toHaveBeenCalled();
    expect(renderer.registerDefinition).not.toHaveBeenCalled();
  });

  it('drops an image callback after the scene switches to another map', async () => {
    const { loader, scene, renderer } = harness();
    loader.register([autotile()]);
    scene.currentMapId = 'map-two';

    succeed(0);
    await flush();

    expect(renderer.registerDefinition).not.toHaveBeenCalled();
  });

  it('drops an image callback after the renderer is replaced', async () => {
    const { loader, scene, textures, renderer } = harness();
    loader.register([autotile()]);
    scene.autotileRenderer = { registerDefinition: vi.fn(), updateAllVisible: vi.fn() };

    succeed(0);
    await flush();

    expect(textures.addSpriteSheet).not.toHaveBeenCalled();
    expect(renderer.registerDefinition).not.toHaveBeenCalled();
  });

  it('creates a visible placeholder and reports a missing snapshot texture', async () => {
    const { loader, context, canvasTexture, textures, renderer } = harness();
    loader.register([autotile()]);

    pending[0].reject(new Error('Member image failed to load'));
    await flush();

    expect(textures.createCanvas).toHaveBeenCalledWith(expect.stringContaining('map-one:3:1234abcd'), 32, 48);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 32, 48);
    expect(canvasTexture.refresh).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Missing snapshot texture'));
    expect(renderer.registerDefinition).toHaveBeenCalledTimes(1);
  });
});
