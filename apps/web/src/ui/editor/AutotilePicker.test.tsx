import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { AutotilePackItem } from '../../services/EditorTypes';
import { loadMemberImageElement } from '../../lib/memberImage';
import { AutotilePicker } from './AutotilePicker';

vi.mock('../../lib/memberImage', () => ({ loadMemberImageElement: vi.fn() }));

const loadMemberImageElementMock = vi.mocked(loadMemberImageElement);

class DirectImageForbidden {
  constructor() {
    throw new Error('direct Image construction is forbidden for protected files');
  }
}

const ITEM: AutotilePackItem = {
  packUuid: 'pack-one',
  autotileId: 'wall-one',
  key: 'wall',
  textureUrl: '/packs/walls/wall-one.png',
  tileWidth: 16,
  tileHeight: 16,
  gridHeight: 32,
  variants: { '0': { col: 0, row: 0 } },
  collide: true,
  placement: 'wall',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Image', DirectImageForbidden);
  loadMemberImageElementMock.mockResolvedValue({
    image: { width: 16, height: 16 } as unknown as HTMLImageElement,
    release: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AutotilePicker protected thumbnails', () => {
  it('loads the stored /packs texture through loadMemberImageElement, never new Image()', async () => {
    render(<AutotilePicker autotileItems={[ITEM]} selectedAutotile={null} />);

    await waitFor(() =>
      expect(loadMemberImageElementMock).toHaveBeenCalledWith('/packs/walls/wall-one.png', expect.anything()),
    );
    expect(loadMemberImageElementMock).toHaveBeenCalledTimes(1);
  });
});
