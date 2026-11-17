// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Phaser from 'phaser';
import { loadMemberImage } from '../services/assetLoader';
import { EditorRenderer } from './EditorRenderer';
import type { Asset } from '../../services/EditorTypes';

vi.mock('../services/assetLoader', () => ({ loadMemberImage: vi.fn() }));
vi.mock('../../lib/directionalImageRegistry', () => ({
  lookupDirectionalImage: vi.fn(() => undefined),
}));

const loadMemberImageMock = vi.mocked(loadMemberImage);

function createSprite() {
  return {
    setAlpha: vi.fn(),
    setDepth: vi.fn(),
    setVisible: vi.fn(),
    setRotation: vi.fn(),
    setTexture: vi.fn(),
    setPosition: vi.fn(),
    setOrigin: vi.fn(),
    setScale: vi.fn(),
    setInteractive: vi.fn(),
    destroy: vi.fn(),
  };
}

function createScene() {
  const sprite = createSprite();
  const scene = {
    add: {
      image: vi.fn(() => sprite),
      graphics: vi.fn(() => ({ setDepth: vi.fn(), clear: vi.fn(), destroy: vi.fn() })),
      text: vi.fn(),
    },
    events: { on: vi.fn(), off: vi.fn() },
    textures: {
      exists: vi.fn(() => false),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      addBase64: vi.fn(),
      remove: vi.fn(),
    },
    load: {
      image: vi.fn(),
      start: vi.fn(),
      setCORS: vi.fn(),
    },
    cameras: { main: { worldView: { centerX: 0, centerY: 0 } } },
  };
  return { scene, sprite };
}

type FakeScene = ReturnType<typeof createScene>['scene'];
function asScene(scene: FakeScene): Phaser.Scene {
  return scene as unknown as Phaser.Scene;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadMemberImageMock.mockResolvedValue(undefined);
});

describe('EditorRenderer protected asset loads', () => {
  it('renders the ghost through loadMemberImage, not scene.load.image', async () => {
    const { scene } = createScene();
    const renderer = new EditorRenderer(asScene(scene));

    renderer.renderGhost({ dataUrl: '/packs/pack-one/chair.png', width: 16, height: 16, rotation: 0 });

    expect(loadMemberImageMock).toHaveBeenCalledTimes(1);
    expect(loadMemberImageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('ghost_'),
      '/packs/pack-one/chair.png',
    );
    expect(scene.load.image).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/packs/'));

    await vi.waitFor(() => expect(scene.add.image).toHaveBeenCalled());
  });

  it('renders placed assets through loadMemberImage, not scene.load.image', async () => {
    const { scene } = createScene();
    const renderer = new EditorRenderer(asScene(scene));
    const asset: Asset = { id: 'a1', key: 'chair', dataUrl: '/packs/pack-one/chair.png', x: 32, y: 48 };

    renderer.renderAssets([asset]);

    expect(loadMemberImageMock).toHaveBeenCalledTimes(1);
    expect(loadMemberImageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('asset_a1'),
      '/packs/pack-one/chair.png',
    );
    expect(scene.load.image).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/packs/'));

    await vi.waitFor(() => expect(scene.add.image).toHaveBeenCalled());
  });

  it('keeps ghost data URLs on the local addBase64 path', () => {
    const { scene } = createScene();
    const renderer = new EditorRenderer(asScene(scene));

    renderer.renderGhost({ dataUrl: 'data:image/png;base64,AAAA', width: 16, height: 16 });

    expect(loadMemberImageMock).not.toHaveBeenCalled();
    expect(scene.textures.addBase64).toHaveBeenCalledTimes(1);
    expect(scene.load.image).not.toHaveBeenCalled();
  });
});
