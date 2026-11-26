// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadMemberImageElement } from './memberImage';
import { splitTilesetImage } from './tilesetUtils';

vi.mock('./memberImage', () => ({ loadMemberImageElement: vi.fn() }));

const loadMemberImageElementMock = vi.mocked(loadMemberImageElement);

class DirectImageForbidden {
  constructor() {
    throw new Error('direct Image construction is forbidden for protected files');
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Image', DirectImageForbidden);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as RenderingContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('splitTilesetImage', () => {
  it('loads a stored /packs reference through loadMemberImageElement, not new Image()', async () => {
    const releaseMock = vi.fn();
    loadMemberImageElementMock.mockResolvedValue({
      image: { width: 32, height: 16 } as unknown as HTMLImageElement,
      release: releaseMock,
    });

    const tiles = await splitTilesetImage('/packs/pack-one/tiles.png', { tileWidth: 16, tileHeight: 16 });

    expect(loadMemberImageElementMock).toHaveBeenCalledTimes(1);
    expect(loadMemberImageElementMock).toHaveBeenCalledWith('/packs/pack-one/tiles.png');
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toMatchObject({ id: '0:0', x: 0, y: 0, row: 0, col: 0 });
    expect(tiles[1]).toMatchObject({ id: '0:1', x: 16, y: 0, row: 0, col: 1 });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('propagates helper failures without a direct fallback', async () => {
    loadMemberImageElementMock.mockRejectedValue(new Error('Member image failed to load'));

    await expect(splitTilesetImage('/packs/pack-one/tiles.png', { tileWidth: 16, tileHeight: 16 })).rejects.toThrow();
    expect(loadMemberImageElementMock).toHaveBeenCalledTimes(1);
  });
});
