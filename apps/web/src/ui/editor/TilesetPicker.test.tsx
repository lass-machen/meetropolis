import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { V2Tileset } from '../../lib/mapV2';
import { loadMemberImageElement } from '../../lib/memberImage';
import { TilesetPicker } from './TilesetPicker';

vi.mock('../../lib/memberImage', () => ({ loadMemberImageElement: vi.fn() }));

const loadMemberImageElementMock = vi.mocked(loadMemberImageElement);

class DirectImageForbidden {
  constructor() {
    throw new Error('direct Image construction is forbidden for protected files');
  }
}

const TILESET: V2Tileset = {
  id: 'tileset-one',
  slot: 2,
  key: 'picker-one',
  imageUrl: '/packs/terrain/picker.png',
  tileWidth: 16,
  tileHeight: 16,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Image', DirectImageForbidden);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  } as unknown as RenderingContext);
  loadMemberImageElementMock.mockResolvedValue({
    image: { width: 64, height: 64 } as unknown as HTMLImageElement,
    release: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TilesetPicker protected images', () => {
  it('loads the stored /packs image through loadMemberImageElement, never new Image()', async () => {
    const { container } = render(<TilesetPicker tileset={TILESET} selectedTileRefId={0} />);

    await waitFor(() =>
      expect(loadMemberImageElementMock).toHaveBeenCalledWith('/packs/terrain/picker.png', expect.anything()),
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    await waitFor(() => expect(canvas?.width).toBe(128));
  });
});
