import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { PackItem } from '../../services/EditorService';
import type { V2Tileset } from '../../lib/mapV2';
import { useMemberAsset } from '../../hooks/useMemberAsset';
import { loadMemberImageElement } from '../../lib/memberImage';
import { TerrainTileGrid } from './TerrainTileGrid';

vi.mock('../../hooks/useMemberAsset', () => ({ useMemberAsset: vi.fn() }));
vi.mock('../../lib/memberImage', () => ({ loadMemberImageElement: vi.fn() }));

const useMemberAssetMock = vi.mocked(useMemberAsset);
const loadMemberImageElementMock = vi.mocked(loadMemberImageElement);

class DirectImageForbidden {
  constructor() {
    throw new Error('direct Image construction is forbidden for protected files');
  }
}

const TILESET: V2Tileset = {
  id: 'tileset-one',
  slot: 1,
  key: 'terrain-one',
  imageUrl: '/packs/terrain/tiles.png',
  tileWidth: 16,
  tileHeight: 16,
};

const PACK_ITEM: PackItem = {
  packUuid: 'pack-one',
  itemId: 'tree-one',
  key: 'tree',
  category: 'terrain',
  dataUrl: '/packs/terrain/tree.png',
  width: 32,
  height: 32,
  collide: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Image', DirectImageForbidden);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as RenderingContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
  useMemberAssetMock.mockReturnValue({ src: 'blob:member-item', status: 'ready', errorStatus: null });
  loadMemberImageElementMock.mockResolvedValue({
    image: { width: 32, height: 16 } as unknown as HTMLImageElement,
    release: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TerrainTileGrid protected tiles', () => {
  it('extracts v2 tileset tiles through loadMemberImageElement, never new Image()', async () => {
    render(<TerrainTileGrid v2Tilesets={[TILESET]} selectedTileRefId={0} />);

    // extractTiles carries no abort signal, so the helper is called with the ref alone.
    await waitFor(() => expect(loadMemberImageElementMock).toHaveBeenCalledWith('/packs/terrain/tiles.png'));
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
  });

  it('loads a stored /packs pack item through useMemberAsset, never as a raw img src', () => {
    render(<TerrainTileGrid v2Tilesets={[]} selectedTileRefId={0} packTerrainItems={[PACK_ITEM]} />);

    expect(useMemberAssetMock).toHaveBeenCalledWith('/packs/terrain/tree.png');
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('blob:member-item');
  });
});
