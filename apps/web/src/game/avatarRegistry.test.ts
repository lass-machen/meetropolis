import { describe, it, expect, vi, afterEach } from 'vitest';
import { AvatarRegistry, type AvatarManifest } from './avatarRegistry';

const API = 'https://api.test';

function manifest(uuid: string): AvatarManifest {
  return {
    id: `custom:${uuid}`,
    packUuid: 'custom',
    avatarKey: uuid,
    displayName: 'Custom Avatar',
    type: 'full',
    spriteUrl: `/packs/avatars/custom/${uuid}.png`,
    frameWidth: 32,
    frameHeight: 32,
    states: {
      idle: { directions: ['down', 'left', 'right', 'up'], frameCount: 1, frameRate: 1, row: 0 },
      walk: { directions: ['down', 'left', 'right', 'up'], frameCount: 4, frameRate: 8, row: 4 },
    },
  };
}

function parseIds(body: BodyInit | null | undefined): string[] {
  const raw = typeof body === 'string' ? body : '{"ids":[]}';
  return (JSON.parse(raw) as { ids: string[] }).ids;
}

function stubResolve(known: Record<string, AvatarManifest>) {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    const manifests: Record<string, AvatarManifest> = {};
    for (const id of parseIds(init?.body)) if (known[id]) manifests[id] = known[id];
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ manifests }) } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AvatarRegistry custom-avatar resolution', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registerManifest makes an avatar known without any request', async () => {
    const reg = new AvatarRegistry();
    const fetchMock = stubResolve({});
    reg.registerManifest(manifest('a'));
    expect(reg.getManifest('custom:a')).not.toBeNull();
    await expect(reg.ensureManifest('custom:a', API)).resolves.toMatchObject({ id: 'custom:a' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves and caches a custom avatar in one request', async () => {
    const reg = new AvatarRegistry();
    const fetchMock = stubResolve({ 'custom:b': manifest('b') });
    const first = await reg.ensureManifest('custom:b', API);
    expect(first).toMatchObject({ id: 'custom:b' });
    // Cached now: a second call issues no further request.
    const second = await reg.ensureManifest('custom:b', API);
    expect(second).toMatchObject({ id: 'custom:b' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple ids into a single batched request', async () => {
    const reg = new AvatarRegistry();
    const fetchMock = stubResolve({ 'custom:c': manifest('c'), 'custom:d': manifest('d') });
    const [c, d] = await Promise.all([reg.ensureManifest('custom:c', API), reg.ensureManifest('custom:d', API)]);
    expect(c).toMatchObject({ id: 'custom:c' });
    expect(d).toMatchObject({ id: 'custom:d' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(parseIds(fetchMock.mock.calls[0][1]?.body).sort()).toEqual(['custom:c', 'custom:d']);
  });

  it('de-duplicates concurrent requests for the same id', async () => {
    const reg = new AvatarRegistry();
    const fetchMock = stubResolve({ 'custom:e': manifest('e') });
    const [a, b] = await Promise.all([reg.ensureManifest('custom:e', API), reg.ensureManifest('custom:e', API)]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('negatively caches an unresolvable id (no request storm)', async () => {
    const reg = new AvatarRegistry();
    const fetchMock = stubResolve({});
    expect(await reg.ensureManifest('custom:missing', API)).toBeNull();
    expect(await reg.ensureManifest('custom:missing', API)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // second call served from negative cache
  });

  it('never requests for non-custom ids', async () => {
    const reg = new AvatarRegistry();
    const fetchMock = stubResolve({});
    expect(await reg.ensureManifest('default-characters:business_man', API)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
