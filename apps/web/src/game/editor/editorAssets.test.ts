// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadMemberImage } from '../services/assetLoader';
import { setAssetPreview } from './editorAssets';
import type { MainSceneLike } from '../types/scene';

vi.mock('../services/assetLoader', () => ({ loadMemberImage: vi.fn() }));
vi.mock('../../lib/directionalImageRegistry', () => ({
  lookupDirectionalImage: vi.fn(() => undefined),
}));

const loadMemberImageMock = vi.mocked(loadMemberImage);

function createScene() {
  const sprite = {
    setAlpha: vi.fn(),
    setDepth: vi.fn(),
    setVisible: vi.fn(),
    setRotation: vi.fn(),
    setTexture: vi.fn(),
    setPosition: vi.fn(),
  };
  const scene = {
    ghostSprite: undefined as unknown,
    ghostTextureKey: undefined as string | undefined,
    textures: {
      exists: vi.fn(() => false),
      once: vi.fn(),
      addBase64: vi.fn(),
      remove: vi.fn(),
    },
    load: {
      image: vi.fn(),
      start: vi.fn(),
      setCORS: vi.fn(),
    },
    add: {
      image: vi.fn(() => sprite),
    },
    mapRef: undefined as unknown,
    cameras: { main: { worldView: { centerX: 0, centerY: 0 } } },
  };
  return { scene, sprite };
}

type FakeScene = ReturnType<typeof createScene>['scene'];
function asScene(scene: FakeScene): MainSceneLike {
  return scene as unknown as MainSceneLike;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadMemberImageMock.mockResolvedValue(undefined);
});

describe('editorAssets ghost preview', () => {
  it('loads a stored /packs reference through loadMemberImage, not scene.load.image', async () => {
    const { scene } = createScene();
    setAssetPreview(asScene(scene), { dataUrl: '/packs/pack-one/chair.png', width: 16, height: 16 });

    expect(loadMemberImageMock).toHaveBeenCalledTimes(1);
    expect(loadMemberImageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('ghost_'),
      '/packs/pack-one/chair.png',
    );
    expect(scene.load.image).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/packs/'));

    await vi.waitFor(() => expect(scene.add.image).toHaveBeenCalled());
  });

  it('keeps data URLs on the local addBase64 path without the member helper', () => {
    const { scene } = createScene();
    setAssetPreview(asScene(scene), { dataUrl: 'data:image/png;base64,AAAA', width: 16, height: 16 });

    expect(loadMemberImageMock).not.toHaveBeenCalled();
    expect(scene.textures.addBase64).toHaveBeenCalledTimes(1);
    expect(scene.load.image).not.toHaveBeenCalled();
  });
});
