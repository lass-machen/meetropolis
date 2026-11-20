import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { avatarRegistry } from '../../game/avatarRegistry';
import { useMemberAsset } from '../../hooks/useMemberAsset';
import { loadMemberImageElement } from '../../lib/memberImage';
import { AvatarSprite } from './AvatarSprite';

vi.mock('../../hooks/useMemberAsset', () => ({ useMemberAsset: vi.fn() }));
vi.mock('../../lib/memberImage', () => ({ loadMemberImageElement: vi.fn() }));

const useMemberAssetMock = vi.mocked(useMemberAsset);
const loadMemberImageElementMock = vi.mocked(loadMemberImageElement);

class DirectImageForbidden {
  constructor() {
    throw new Error('direct Image construction is forbidden for protected files');
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Image', DirectImageForbidden);
  useMemberAssetMock.mockReturnValue({ src: null, status: 'idle', errorStatus: null });
  loadMemberImageElementMock.mockRejectedValue(new Error('not stubbed'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AvatarSprite protected previews', () => {
  it('loads a stored /packs preview through useMemberAsset, never as a raw img src', () => {
    avatarRegistry.registerManifest({
      id: 'test-pack:t9f-hero',
      packUuid: 'test-pack',
      avatarKey: 't9f-hero',
      displayName: 'T9F Hero',
      type: 'full',
      spriteUrl: '/packs/avatars/t9f-sheet.png',
      frameWidth: 32,
      frameHeight: 32,
      states: {},
      previewUrl: '/packs/avatars/t9f-preview.png',
    });
    useMemberAssetMock.mockReturnValue({ src: 'blob:member-preview', status: 'ready', errorStatus: null });

    render(<AvatarSprite avatarId="test-pack:t9f-hero" />);

    expect(useMemberAssetMock).toHaveBeenCalledWith('/packs/avatars/t9f-preview.png');
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('blob:member-preview');
    expect(document.querySelector('img[src*="/packs"]')).toBeNull();
  });

  it('draws the sprite sheet through loadMemberImageElement, never new Image()', async () => {
    const release = vi.fn();
    avatarRegistry.registerManifest({
      id: 'test-pack:t9f-hero-canvas',
      packUuid: 'test-pack',
      avatarKey: 't9f-hero-canvas',
      displayName: 'T9F Canvas Hero',
      type: 'full',
      spriteUrl: '/packs/avatars/t9f-canvas-sheet.png',
      frameWidth: 32,
      frameHeight: 32,
      states: {},
    });
    loadMemberImageElementMock.mockResolvedValue({
      image: { width: 32, height: 32 } as unknown as HTMLImageElement,
      release,
    });

    render(<AvatarSprite avatarId="test-pack:t9f-hero-canvas" />);

    await waitFor(() =>
      expect(loadMemberImageElementMock).toHaveBeenCalledWith('/packs/avatars/t9f-canvas-sheet.png', expect.anything()),
    );
  });
});
