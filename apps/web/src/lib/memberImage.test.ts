import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { acquireMemberAsset, MemberAssetError } from './memberAssets';
import { loadMemberImageElement } from './memberImage';

vi.mock('./memberAssets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./memberAssets')>()),
  acquireMemberAsset: vi.fn(),
}));

const acquireMock = vi.mocked(acquireMemberAsset);
const releaseMock = vi.fn();

// Stand-in for the browser Image: captures instances so tests can fire events.
class ImageStub {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin: string | null = '';
  src = '';
  constructor() {
    created.push(this);
  }
}

let created: ImageStub[] = [];

beforeEach(() => {
  created = [];
  acquireMock.mockReset();
  releaseMock.mockReset();
  acquireMock.mockResolvedValue({ url: 'blob:member-1', release: releaseMock });
  vi.stubGlobal('Image', ImageStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadMemberImageElement', () => {
  it('resolves with the image and leaves release to the caller', async () => {
    const pending = loadMemberImageElement('/packs/hero.png');
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].src).toBe('blob:member-1');
    created[0].onload?.();
    const result = await pending;
    expect(result.image).toBeInstanceOf(ImageStub);
    expect(result.release).toBe(releaseMock);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('releases and rejects when the image fails', async () => {
    const pending = loadMemberImageElement('/packs/hero.png');
    await vi.waitFor(() => expect(created).toHaveLength(1));
    created[0].onerror?.();
    await expect(pending).rejects.toThrow();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('sets crossOrigin only when provided', async () => {
    const withOpt = loadMemberImageElement('/packs/a.png', { crossOrigin: 'anonymous' });
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].crossOrigin).toBe('anonymous');
    created[0].onload?.();
    await withOpt;

    const withoutOpt = loadMemberImageElement('/packs/b.png');
    await vi.waitFor(() => expect(created).toHaveLength(2));
    expect(created[1].crossOrigin).toBe('');
    created[1].onload?.();
    await withoutOpt;
  });

  it('rejects without creating an image when acquire fails', async () => {
    acquireMock.mockRejectedValue(new MemberAssetError(403, 'forbidden'));
    await expect(loadMemberImageElement('/packs/hero.png')).rejects.toMatchObject({ status: 403 });
    expect(created).toHaveLength(0);
  });
});
