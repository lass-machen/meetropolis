import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useMemberAsset } from '../../hooks/useMemberAsset';
import { loadMemberImageElement } from '../../lib/memberImage';
import { AvatarSettings } from './AvatarSettings';

vi.mock('../../hooks/useMemberAsset', () => ({ useMemberAsset: vi.fn() }));
vi.mock('../../lib/memberImage', () => ({ loadMemberImageElement: vi.fn() }));

const useMemberAssetMock = vi.mocked(useMemberAsset);
const loadMemberImageElementMock = vi.mocked(loadMemberImageElement);

class DirectImageForbidden {
  constructor() {
    throw new Error('direct Image construction is forbidden for protected files');
  }
}

const PACKS_RESPONSE = [
  {
    uuid: 'pack-one',
    avatars: [
      {
        key: 'remote-hero',
        displayName: 'Remote Hero',
        spriteUrl: '/packs/avatars/remote-sheet.png',
        frameWidth: 32,
        frameHeight: 32,
        previewUrl: '/packs/avatars/remote-preview.png',
      },
      {
        key: 'canvas-hero',
        displayName: 'Canvas Hero',
        spriteUrl: '/packs/avatars/canvas-sheet.png',
        frameWidth: 32,
        frameHeight: 32,
      },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Image', DirectImageForbidden);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(PACKS_RESPONSE) }));
  useMemberAssetMock.mockReturnValue({ src: 'blob:member-preview', status: 'ready', errorStatus: null });
  loadMemberImageElementMock.mockResolvedValue({
    image: { width: 32, height: 32 } as unknown as HTMLImageElement,
    release: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AvatarSettings protected previews', () => {
  it('loads a stored /packs preview through useMemberAsset, never as a raw img src', async () => {
    render(<AvatarSettings currentAvatarId="pack-one:remote-hero" onAvatarChange={() => {}} />);

    await waitFor(() => expect(useMemberAssetMock).toHaveBeenCalledWith('/packs/avatars/remote-preview.png'));
    const images = document.querySelectorAll('img');
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img.getAttribute('src')).not.toContain('/packs');
    }
  });

  it('draws a stored /packs sprite through loadMemberImageElement, never new Image()', async () => {
    render(<AvatarSettings currentAvatarId="pack-one:canvas-hero" onAvatarChange={() => {}} />);

    await waitFor(() =>
      expect(loadMemberImageElementMock).toHaveBeenCalledWith(
        expect.stringContaining('/packs/avatars/canvas-sheet.png'),
        expect.anything(),
      ),
    );
  });
});
