// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { V2Autotile } from '../../lib/mapV2';
import { logger } from '../../lib/logger';
import { AutotileTextureLoader, autotileTextureKey } from './AutotileTextureLoader';

vi.mock('../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const images: FakeImage[] = [];

class FakeImage {
  crossOrigin = '';
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    images.push(this);
  }
}

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

beforeEach(() => {
  images.length = 0;
  vi.stubGlobal('Image', FakeImage);
  vi.clearAllMocks();
});

describe('autotile texture snapshots', () => {
  it('isolates texture keys by map, slot, and snapshot hash', () => {
    const item = autotile();

    expect(autotileTextureKey('map-one', item)).not.toBe(autotileTextureKey('map-two', item));
    expect(autotileTextureKey('map-one', item)).not.toBe(autotileTextureKey('map-one', { ...item, slot: 4 }));
    expect(autotileTextureKey('map-one', item)).not.toBe(autotileTextureKey('map-one', { ...item, hash: 'ffffffff' }));
  });

  it('drops an image callback after the map renderer is destroyed', () => {
    const { loader, textures, renderer } = harness();
    loader.register([autotile()]);
    const staleOnload = images[0].onload;

    loader.destroy();
    staleOnload?.();

    expect(textures.addSpriteSheet).not.toHaveBeenCalled();
    expect(renderer.registerDefinition).not.toHaveBeenCalled();
  });

  it('drops an image callback after the scene switches to another map', () => {
    const { loader, scene, renderer } = harness();
    loader.register([autotile()]);
    scene.currentMapId = 'map-two';

    images[0].onload?.();

    expect(renderer.registerDefinition).not.toHaveBeenCalled();
  });

  it('drops an image callback after the renderer is replaced', () => {
    const { loader, scene, textures, renderer } = harness();
    loader.register([autotile()]);
    scene.autotileRenderer = { registerDefinition: vi.fn(), updateAllVisible: vi.fn() };

    images[0].onload?.();

    expect(textures.addSpriteSheet).not.toHaveBeenCalled();
    expect(renderer.registerDefinition).not.toHaveBeenCalled();
  });

  it('creates a visible placeholder and reports a missing snapshot texture', () => {
    const { loader, context, canvasTexture, textures, renderer } = harness();
    loader.register([autotile()]);

    images[0].onerror?.();

    expect(textures.createCanvas).toHaveBeenCalledWith(expect.stringContaining('map-one:3:1234abcd'), 32, 48);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 32, 48);
    expect(canvasTexture.refresh).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Missing snapshot texture'));
    expect(renderer.registerDefinition).toHaveBeenCalledTimes(1);
  });
});
