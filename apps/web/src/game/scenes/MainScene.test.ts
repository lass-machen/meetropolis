import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MainScene } from './MainScene';
import { avatarRegistry, type AvatarManifest } from '../avatarRegistry';
import { loadMemberSpritesheet } from '../services/assetLoader';

vi.mock('../../lib/runtimeConfig', () => ({
  getApiBaseFromWindow: () => 'https://api.test',
}));

vi.mock('../services/assetLoader', () => ({
  loadMemberImage: vi.fn(),
  loadMemberSpritesheet: vi.fn(),
}));

const loadMemberSpritesheetMock = vi.mocked(loadMemberSpritesheet);

function heroManifest(suffix: string): AvatarManifest {
  return {
    id: `pack-9:${suffix}`,
    packUuid: 'pack-9',
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

/**
 * Minimal host for `changeHeroAvatar` via the prototype: the loader fires
 * `complete` synchronously on `start()`, so a `once('complete')`-based
 * implementation swaps the avatar before its texture arrived.
 */
function makeHost(opts: { active?: boolean } = {}) {
  const changeAvatar = vi.fn();
  const completeHandlers: Array<() => void> = [];
  const host = {
    textures: { exists: vi.fn(() => false) },
    load: {
      once: vi.fn((event: string, fn: () => void) => {
        if (event === 'complete') completeHandlers.push(fn);
      }),
      start: vi.fn(() => {
        for (const fn of completeHandlers.splice(0)) fn();
      }),
    },
    playerManager: { changeAvatar },
    sys: { isActive: () => opts.active ?? true },
  };
  return { host, changeAvatar };
}

describe('MainScene.changeHeroAvatar (member assets)', () => {
  beforeEach(() => {
    loadMemberSpritesheetMock.mockReset();
    loadMemberSpritesheetMock.mockResolvedValue(undefined);
  });

  it('calls changeAvatar only after the preload promise fulfills, never on immediate complete', async () => {
    avatarRegistry.registerManifest(heroManifest('hero-immediate'));
    const { host, changeAvatar } = makeHost();
    MainScene.prototype.changeHeroAvatar.call(host as unknown as MainScene, 'pack-9:hero-immediate');
    expect(host.load.start).not.toHaveBeenCalled();
    expect(changeAvatar).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(changeAvatar).toHaveBeenCalledWith('pack-9:hero-immediate'));
  });

  it('keeps the current avatar when the member load fails', async () => {
    avatarRegistry.registerManifest(heroManifest('hero-broken'));
    loadMemberSpritesheetMock.mockRejectedValueOnce(new Error('forbidden'));
    const { host, changeAvatar } = makeHost();
    MainScene.prototype.changeHeroAvatar.call(host as unknown as MainScene, 'pack-9:hero-broken');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(changeAvatar).not.toHaveBeenCalled();
  });

  it('does not swap the avatar when the scene is no longer active', async () => {
    avatarRegistry.registerManifest(heroManifest('hero-stale'));
    const { host, changeAvatar } = makeHost({ active: false });
    MainScene.prototype.changeHeroAvatar.call(host as unknown as MainScene, 'pack-9:hero-stale');
    await vi.waitFor(() => expect(loadMemberSpritesheetMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(changeAvatar).not.toHaveBeenCalled();
  });
});
