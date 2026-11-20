import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  acquireMemberAsset,
  isMemberAssetRef,
  MemberAssetError,
  resetMemberAssets,
  toMemberAssetUrl,
} from './memberAssets';

const API_BASE = 'https://tiles.example.com:2567';

function stubWindow(): void {
  Object.defineProperty(window, 'location', {
    value: { search: '', protocol: 'https:', hostname: 'tiles.example.com' },
    writable: true,
    configurable: true,
  });
}

function okResponse(blob: Blob): Response {
  return { ok: true, status: 200, blob: () => Promise.resolve(blob) } as Response;
}

describe('toMemberAssetUrl', () => {
  it('translates the four stored reference forms', () => {
    stubWindow();
    expect(toMemberAssetUrl('/packs/abc/file.png')).toBe(`${API_BASE}/member-assets/v1/packs/abc/file.png`);
    expect(toMemberAssetUrl('/npc-media/x/y.bin')).toBe(`${API_BASE}/member-assets/v1/npc-media/x/y.bin`);
    expect(toMemberAssetUrl(`${API_BASE}/packs/abc/file.png`)).toBe(`${API_BASE}/member-assets/v1/packs/abc/file.png`);
    expect(toMemberAssetUrl(`${API_BASE}/npc-media/x/y.bin`)).toBe(`${API_BASE}/member-assets/v1/npc-media/x/y.bin`);
  });

  it('translates nested pack generation paths unchanged', () => {
    expect(toMemberAssetUrl('/packs/abc/generations/g1/tiles/a.png')).toBe(
      `${API_BASE}/member-assets/v1/packs/abc/generations/g1/tiles/a.png`,
    );
    expect(
      toMemberAssetUrl('/packs/office-kit/generations/550e8400-e29b-41d4-a716-446655440000/chair.12ab34cd.png'),
    ).toBe(
      `${API_BASE}/member-assets/v1/packs/office-kit/generations/550e8400-e29b-41d4-a716-446655440000/chair.12ab34cd.png`,
    );
    expect(toMemberAssetUrl('/packs/office-kit/chair.12ab34cd.png')).toBe(
      `${API_BASE}/member-assets/v1/packs/office-kit/chair.12ab34cd.png`,
    );
    expect(toMemberAssetUrl('/packs/abc/generations/../a.png')).toBeNull();
  });

  it('drops query and fragment', () => {
    stubWindow();
    expect(toMemberAssetUrl('/packs/a.png?v=2#frag')).toBe(`${API_BASE}/member-assets/v1/packs/a.png`);
    expect(toMemberAssetUrl(`${API_BASE}/npc-media/x.bin?dl=1`)).toBe(`${API_BASE}/member-assets/v1/npc-media/x.bin`);
  });

  it('returns null for anything else', () => {
    stubWindow();
    expect(toMemberAssetUrl('')).toBeNull();
    expect(toMemberAssetUrl('data:image/png;base64,aaa')).toBeNull();
    expect(toMemberAssetUrl('blob:https://x/y')).toBeNull();
    expect(toMemberAssetUrl('/assets/x.png')).toBeNull();
    expect(toMemberAssetUrl('https://other.example.com/packs/a.png')).toBeNull();
    expect(toMemberAssetUrl('//tiles.example.com/packs/a.png')).toBeNull();
    expect(toMemberAssetUrl('packs/a.png')).toBeNull();
    expect(toMemberAssetUrl('/packs/')).toBeNull();
    expect(toMemberAssetUrl('/packs/../secret.png')).toBeNull();
    expect(toMemberAssetUrl('/packs/%2e%2e/secret.png')).toBeNull();
    expect(toMemberAssetUrl('/packs/%2E%2E/secret.png')).toBeNull();
    expect(toMemberAssetUrl('/npc-media/a%2fb.png')).toBeNull();
    expect(toMemberAssetUrl(`${API_BASE}/packs/../secret.png`)).toBeNull();
  });

  it('isMemberAssetRef mirrors toMemberAssetUrl', () => {
    stubWindow();
    expect(isMemberAssetRef('/packs/a.png')).toBe(true);
    expect(isMemberAssetRef('/assets/a.png')).toBe(false);
  });
});

describe('acquireMemberAsset', () => {
  const fetchMock = vi.fn();
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    stubWindow();
    resetMemberAssets();
    fetchMock.mockReset();
    createObjectURL.mockReset();
    revokeObjectURL.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    createObjectURL.mockReturnValue('blob:member-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches with protocol header, cookie auth, no store and no redirects', async () => {
    fetchMock.mockResolvedValue(okResponse(new Blob(['x'])));
    const handle = await acquireMemberAsset('/packs/a.png');
    expect(handle.url).toBe('blob:member-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(`${API_BASE}/member-assets/v1/packs/a.png`);
    expect(init.credentials).toBe('include');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
    expect(init.headers['X-Asset-Protocol']).toBe('1');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    handle.release();
  });

  it('rejects with MemberAssetError status 403 and no blob URL', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await expect(acquireMemberAsset('/packs/a.png')).rejects.toMatchObject({ status: 403 });
    await expect(acquireMemberAsset('/packs/a.png')).rejects.toBeInstanceOf(MemberAssetError);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('shares one fetch and blob URL, revokes once after the last release', async () => {
    fetchMock.mockResolvedValue(okResponse(new Blob(['x'])));
    const first = await acquireMemberAsset('/packs/a.png');
    const second = await acquireMemberAsset('/packs/a.png');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.url).toBe(first.url);
    first.release();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    second.release();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(first.url);
    second.release();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('reset during inflight aborts, discards the result and records nothing', async () => {
    let resolveFetch!: (response: Response) => void;
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          resolveFetch = resolve;
        }),
    );
    const pending = acquireMemberAsset('/packs/a.png');
    resetMemberAssets();
    resolveFetch(okResponse(new Blob(['late'])));
    await expect(pending).rejects.toMatchObject({ status: 0 });
    await expect(pending).rejects.toBeInstanceOf(MemberAssetError);
    expect(createObjectURL).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(okResponse(new Blob(['fresh'])));
    const fresh = await acquireMemberAsset('/packs/a.png');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fresh.url).toBe('blob:member-1');
    fresh.release();
  });

  it('passes non-member refs through without fetch', async () => {
    const handle = await acquireMemberAsset('/assets/x.png');
    expect(handle.url).toBe('/assets/x.png');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => handle.release()).not.toThrow();
  });
});
