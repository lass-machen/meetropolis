import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BootScene } from './BootScene';
import { avatarRegistry, type AvatarManifest } from '../avatarRegistry';
import { loadMemberSpritesheet } from '../services/assetLoader';
import { useMapStore } from '../../state/mapStore';
import { fetchStateV2 } from '../../lib/mapV2';

vi.mock('../../lib/runtimeConfig', () => ({
  getApiBaseFromWindow: () => 'https://api.test',
}));

vi.mock('../services/assetLoader', () => ({
  loadMemberImage: vi.fn(),
  loadMemberSpritesheet: vi.fn(),
}));

vi.mock('../../lib/mapV2', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mapV2')>()),
  fetchStateV2: vi.fn(),
  preloadTilesetImages: vi.fn(),
}));

const loadMemberSpritesheetMock = vi.mocked(loadMemberSpritesheet);
const fetchStateV2Mock = vi.mocked(fetchStateV2);

function memberManifest(suffix: string): AvatarManifest {
  return {
    id: `pack-2:${suffix}`,
    packUuid: 'pack-2',
    avatarKey: suffix,
    displayName: 'Hero',
    type: 'full',
    spriteUrl: `/packs/avatars/${suffix}.png`,
    frameWidth: 32,
    frameHeight: 32,
    states: {
      idle: { directions: ['down', 'left', 'right', 'up'], frameCount: 1, frameRate: 1, row: 0 },
      walk: { directions: ['down', 'left', 'right', 'up'], frameCount: 4, frameRate: 8, row: 4 },
    },
  };
}

function makeFakeScene() {
  const animsCreate = vi.fn();
  const host = {
    load: {
      image: vi.fn((_key: string, _url: string) => {}),
      spritesheet: vi.fn((_key: string, _url: string, _config: unknown) => {}),
      once: vi.fn((_event: string, _fn: () => void) => {}),
      start: vi.fn(() => {}),
    },
    textures: { exists: vi.fn(() => false) },
    anims: {
      exists: vi.fn(() => false),
      generateFrameNumbers: vi.fn(() => []),
      create: animsCreate,
    },
    scene: { start: vi.fn((_key: string) => {}), getScene: vi.fn(() => undefined) },
  };
  return { host, animsCreate };
}

function heroAnimCreated(animsCreate: ReturnType<typeof vi.fn>, suffix: string): boolean {
  return animsCreate.mock.calls.some(
    (call) =>
      typeof call[0] === 'object' &&
      call[0] !== null &&
      'key' in call[0] &&
      typeof call[0].key === 'string' &&
      (call[0].key as string).startsWith(`avatar_pack-2_${suffix}_`),
  );
}

describe('BootScene avatar preload (member assets)', () => {
  beforeEach(() => {
    loadMemberSpritesheetMock.mockReset();
    loadMemberSpritesheetMock.mockResolvedValue(undefined);
    fetchStateV2Mock.mockReset();
    fetchStateV2Mock.mockResolvedValue({
      mapMeta: { width: 1, height: 1, tileWidth: 16, tileHeight: 16, chunkSize: 32, version: 1 },
      tilesetRegistry: [],
      autotilePalette: [],
      layerIndex: {},
    });
    useMapStore.setState({ currentMapId: 'm1' });
  });

  afterEach(() => {
    window.localStorage.removeItem('avatarId');
    useMapStore.setState({ currentMapId: '' });
    vi.unstubAllGlobals();
  });

  it('creates member avatar animations only after the preload promise fulfills', async () => {
    window.localStorage.setItem('avatarId', 'pack-2:hero-deferred');
    avatarRegistry.registerManifest(memberManifest('hero-deferred'));
    const { host, animsCreate } = makeFakeScene();
    BootScene.prototype.preload.call(host as unknown as BootScene);
    const pending = (host as unknown as { heroAvatarLoad: Promise<void> | null }).heroAvatarLoad;
    expect(pending).toBeInstanceOf(Promise);
    BootScene.prototype.create.call(host as unknown as BootScene);
    // Default animations apply immediately, the member avatar waits.
    expect(animsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'avatar_default-characters_business_man_idle_down' }),
    );
    expect(heroAnimCreated(animsCreate, 'hero-deferred')).toBe(false);
    await pending;
    await vi.waitFor(() => expect(heroAnimCreated(animsCreate, 'hero-deferred')).toBe(true));
  });

  it('creates default avatar animations immediately', () => {
    window.localStorage.removeItem('avatarId');
    const { host, animsCreate } = makeFakeScene();
    BootScene.prototype.preload.call(host as unknown as BootScene);
    BootScene.prototype.create.call(host as unknown as BootScene);
    expect(animsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'avatar_default-characters_business_man_idle_down' }),
    );
  });
});
