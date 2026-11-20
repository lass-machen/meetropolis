// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type Phaser from 'phaser';
import { loadMemberImageElement } from '../../lib/memberImage';
import { EditorRenderer } from './EditorRenderer';
import { EditorIntegration } from './integration';

vi.mock('./EditorRenderer', () => {
  function FakeEditorRenderer(this: unknown) {
    return { renderGhost: vi.fn(), clearAll: vi.fn() };
  }
  return { EditorRenderer: vi.fn(FakeEditorRenderer) };
});
vi.mock('./EditorInputHandler', () => {
  function FakeEditorInputHandler(this: unknown) {
    return {};
  }
  return { EditorInputHandler: vi.fn(FakeEditorInputHandler) };
});
vi.mock('../../services/EditorService', () => ({ EditorService: { subscribe: vi.fn(() => () => {}) } }));
vi.mock('../collision/overlay', () => ({ updateCollisionOverlay: vi.fn() }));
vi.mock('../../lib/mapV2', () => ({
  splitTileRefId: vi.fn(() => ({ slot: 1, tileIndex: 5 })),
  fetchStateV2: vi.fn(() =>
    Promise.resolve({
      tilesetRegistry: [
        { slot: 1, key: 'tiles', imageUrl: '/packs/pack-one/tiles.png', tileWidth: 16, tileHeight: 16 },
      ],
    }),
  ),
  baseUrl: vi.fn(() => 'https://api.test'),
}));
vi.mock('../../state/mapStore', () => ({
  useMapStore: { getState: () => ({ currentMapId: 'map-1' }) },
}));
vi.mock('../../lib/memberImage', () => ({ loadMemberImageElement: vi.fn() }));

const loadMemberImageElementMock = vi.mocked(loadMemberImageElement);

class DirectImageForbidden {
  constructor() {
    throw new Error('direct Image construction is forbidden for protected files');
  }
}

function fakeScene(): Phaser.Scene {
  return {} as unknown as Phaser.Scene;
}

function rendererGhost(): Mock {
  const constructed = vi.mocked(EditorRenderer).mock.results;
  const instance = constructed[constructed.length - 1]?.value as { renderGhost: Mock };
  return instance.renderGhost;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Image', DirectImageForbidden);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as RenderingContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EditorIntegration terrain ghost', () => {
  it('loads the tileset through loadMemberImageElement, never through new Image()', async () => {
    const releaseMock = vi.fn();
    loadMemberImageElementMock.mockResolvedValue({
      image: { width: 48, height: 16 } as unknown as HTMLImageElement,
      release: releaseMock,
    });

    const integration = new EditorIntegration(fakeScene(), 16, {});
    (integration as unknown as { updateTerrainGhost(id: number): void }).updateTerrainGhost(12345);

    await vi.waitFor(() =>
      expect(loadMemberImageElementMock).toHaveBeenCalledWith('https://api.test/packs/pack-one/tiles.png'),
    );
    await vi.waitFor(() => expect(rendererGhost()).toHaveBeenCalled());

    const preview = rendererGhost().mock.calls[0][0] as { dataUrl: string };
    expect(preview.dataUrl).toContain('data:');
    expect(releaseMock).toHaveBeenCalled();
  });
});
