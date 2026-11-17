import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Phaser from 'phaser';
import { acquireMemberAsset, MemberAssetError } from '../../lib/memberAssets';
import { loadAssets, loadMemberImage, loadMemberSpritesheet } from './assetLoader';

vi.mock('../../lib/memberAssets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/memberAssets')>()),
  acquireMemberAsset: vi.fn(),
}));

const acquireMock = vi.mocked(acquireMemberAsset);
const releaseMock = vi.fn();

type LoadEventHandler = (...args: unknown[]) => void;

// Minimal fake of the LoaderPlugin surface used by the helpers.
function createScene(existing: string[] = []) {
  const listeners = new Map<string, LoadEventHandler[]>();
  const present = new Set(existing);
  const add = (event: string, fn: LoadEventHandler) => {
    const list = listeners.get(event) ?? [];
    list.push(fn);
    listeners.set(event, list);
  };
  const scene = {
    textures: { exists: (key: string) => present.has(key) },
    load: {
      image: vi.fn((_key: string, _url: string) => {}),
      spritesheet: vi.fn((_key: string, _url: string, _frameConfig: unknown) => {}),
      once: vi.fn((event: string, fn: LoadEventHandler) => add(event, fn)),
      on: vi.fn((event: string, fn: LoadEventHandler) => add(event, fn)),
      off: vi.fn((event: string, fn: LoadEventHandler) => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((kept) => kept !== fn),
        );
      }),
      start: vi.fn(() => {}),
      isLoading: vi.fn(() => false),
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
    },
  };
  return scene;
}

type FakeScene = ReturnType<typeof createScene>;
function asScene(scene: FakeScene): Phaser.Scene {
  return scene as unknown as Phaser.Scene;
}

beforeEach(() => {
  acquireMock.mockReset();
  releaseMock.mockReset();
  acquireMock.mockResolvedValue({ url: 'blob:member-1', release: releaseMock });
});

describe('loadMemberImage', () => {
  it('resolves without acquiring when the texture already exists', async () => {
    const scene = createScene(['hero']);
    await loadMemberImage(asScene(scene), 'hero', '/packs/hero.png');
    expect(acquireMock).not.toHaveBeenCalled();
    expect(scene.load.image).not.toHaveBeenCalled();
  });

  it('loads through a blob URL and releases on completion', async () => {
    const scene = createScene();
    const pending = loadMemberImage(asScene(scene), 'hero', '/packs/hero.png');
    await vi.waitFor(() => expect(scene.load.image).toHaveBeenCalled());
    expect(scene.load.image).toHaveBeenCalledWith('hero', 'blob:member-1');
    scene.emit('filecomplete-image-hero', 'hero', 'image', {});
    await pending;
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(scene.load.start).toHaveBeenCalledTimes(1);
  });

  it('does not restart the loader while it is already running', async () => {
    const scene = createScene();
    scene.load.isLoading.mockReturnValue(true);
    const pending = loadMemberImage(asScene(scene), 'hero', '/packs/hero.png');
    await vi.waitFor(() => expect(scene.load.image).toHaveBeenCalled());
    scene.emit('filecomplete-image-hero', 'hero', 'image', {});
    await pending;
    expect(scene.load.start).not.toHaveBeenCalled();
  });

  it('releases and rejects when exactly that file fails', async () => {
    const scene = createScene();
    const pending = loadMemberImage(asScene(scene), 'hero', '/packs/hero.png');
    await vi.waitFor(() => expect(scene.load.image).toHaveBeenCalled());
    scene.emit('loaderror', { key: 'hero', type: 'image' });
    await expect(pending).rejects.toThrow();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('ignores load errors for other keys', async () => {
    const scene = createScene();
    const pending = loadMemberImage(asScene(scene), 'hero', '/packs/hero.png');
    await vi.waitFor(() => expect(scene.load.image).toHaveBeenCalled());
    scene.emit('loaderror', { key: 'other', type: 'image' });
    scene.emit('filecomplete-image-hero', 'hero', 'image', {});
    await pending;
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rejects without touching the loader when acquire fails', async () => {
    acquireMock.mockRejectedValue(new MemberAssetError(403, 'forbidden'));
    const scene = createScene();
    await expect(loadMemberImage(asScene(scene), 'hero', '/packs/hero.png')).rejects.toMatchObject({
      status: 403,
    });
    expect(scene.load.image).not.toHaveBeenCalled();
    expect(scene.load.start).not.toHaveBeenCalled();
  });
});

describe('loadMemberSpritesheet', () => {
  it('loads through a blob URL with the frame config and releases on completion', async () => {
    const frameConfig = { frameWidth: 16, frameHeight: 16 };
    const scene = createScene();
    const pending = loadMemberSpritesheet(asScene(scene), 'hero', '/packs/hero.png', frameConfig);
    await vi.waitFor(() => expect(scene.load.spritesheet).toHaveBeenCalled());
    expect(scene.load.spritesheet).toHaveBeenCalledWith('hero', 'blob:member-1', frameConfig);
    scene.emit('filecomplete-spritesheet-hero', 'hero', 'spritesheet', {});
    await pending;
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rejects without touching the loader when acquire fails', async () => {
    acquireMock.mockRejectedValue(new MemberAssetError(404, 'missing'));
    const scene = createScene();
    await expect(
      loadMemberSpritesheet(asScene(scene), 'hero', '/packs/hero.png', { frameWidth: 16, frameHeight: 16 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(scene.load.spritesheet).not.toHaveBeenCalled();
  });
});

describe('loadAssets', () => {
  it('loads missing assets and skips existing textures', async () => {
    const scene = createScene(['icon']);
    const pending = loadAssets(asScene(scene), [
      { key: 'icon', url: '/packs/icon.png' },
      { key: 'hero', url: 'https://cdn.example.test/hero.png' },
    ]);
    await vi.waitFor(() => expect(scene.load.image).toHaveBeenCalled());
    expect(scene.load.image).toHaveBeenCalledTimes(1);
    expect(scene.load.image).toHaveBeenCalledWith('hero', 'blob:member-1');
    scene.emit('filecomplete-image-hero', 'hero', 'image', {});
    await pending;
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
