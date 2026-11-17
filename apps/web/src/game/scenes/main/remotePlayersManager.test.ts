import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Phaser from 'phaser';
import { RemotePlayersManager } from './remotePlayersManager';

const preloadState = vi.hoisted(() => ({ calls: 0 }));

// Plain function, deliberately not vi.fn: the spy runtime attaches .then to
// every promise a mock returns (settledResults tracking), which would mark
// the rejection as handled and hide exactly what this test observes.
vi.mock('../../avatarRegistry', () => ({
  avatarRegistry: {
    getDefaultAvatarId: () => 'default-avatar',
    getTextureKey: (avatarId: string) => `avatar_${avatarId}`,
    getManifest: () => ({ id: 'test-manifest' }),
    ensureManifest: () => Promise.resolve(null),
    preloadAvatar: () => {
      preloadState.calls += 1;
      return Promise.reject(new Error('protected file refused'));
    },
    getAnimationKey: (avatarId: string, state: string, direction: string) => `anim_${avatarId}_${state}_${direction}`,
    createAnimations: () => {},
    getIdleFrame: () => ({ texture: 'avatar_default-avatar', frame: 0 }),
  },
}));

/**
 * Minimal scene fake for RemotePlayersManager. Only the surface used by
 * createRemoteSprite / ensureAvatarLoaded is provided; the avatar registry
 * is mocked above, so no texture ever loads for real.
 */
function makeScene() {
  const existing = new Set<string>();
  const sprite = {
    active: true,
    y: 20,
    displayHeight: 32,
    setDepth: vi.fn(),
    setPosition: vi.fn(),
    setTexture: vi.fn(),
    play: vi.fn(),
    anims: { isPlaying: false, currentAnim: undefined, stop: vi.fn() },
  };
  const scene = {
    textures: { exists: (key: string) => existing.has(key) },
    load: { once: vi.fn(), start: vi.fn() },
    add: { sprite: vi.fn(() => sprite) },
    anims: {},
  };
  const manager = new RemotePlayersManager(scene as unknown as Phaser.Scene);
  return { manager };
}

const players = {
  remote1: { x: 10, y: 20, direction: 'down' as const, avatarId: 'guard' },
};

describe('RemotePlayersManager (refused avatar load)', () => {
  beforeEach(() => {
    preloadState.calls = 0;
  });

  it('produces no unhandled rejection when preloadAvatar rejects', async () => {
    const { manager } = makeScene();
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      manager.syncRemotePlayers(players);
      await vi.waitFor(() => expect(preloadState.calls).toBe(1));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('retries the load on a later update after preloadAvatar rejected', async () => {
    const { manager } = makeScene();
    manager.syncRemotePlayers(players);
    await vi.waitFor(() => expect(preloadState.calls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    manager.syncRemotePlayers(players);
    await vi.waitFor(() => expect(preloadState.calls).toBe(2));
  });
});
