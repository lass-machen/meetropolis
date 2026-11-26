import { describe, expect, it, vi } from 'vitest';
import { acquirePackLocksForAssetUrls, packUuidOfAssetUrl } from './advisoryLocks.js';
import type { MapDb } from './mapChunkMutations.js';

describe('packUuidOfAssetUrl', () => {
  it.each([
    ['/packs/office-pack/desk.png', 'office-pack'],
    ['/packs/office-pack/generations/g1/desk.png', 'office-pack'],
    ['https://api.example.test/packs/office-pack/desk.png', 'office-pack'],
    ['/member-assets/v1/packs/office-pack/desk.png', 'office-pack'],
    ['/assets/tilesets/office_floor.png', null],
    ['data:image/png;base64,AAAA', null],
    ['/packs/', null],
    ['https://[broken/packs/x/y.png', null],
  ])('maps %s to %s', (url, expected) => {
    expect(packUuidOfAssetUrl(url)).toBe(expected);
  });
});

describe('acquirePackLocksForAssetUrls', () => {
  it('locks each referenced pack once in sorted order and ignores other URLs', async () => {
    const keys: string[] = [];
    const tx = {
      $queryRaw: vi.fn((query: { values: unknown[] }) => {
        keys.push(String(query.values[0]));
        return Promise.resolve([]);
      }),
    } as unknown as MapDb;

    await acquirePackLocksForAssetUrls(tx, [
      '/packs/zeta/a.png',
      '/assets/tilesets/floor.png',
      'https://api.example.test/packs/alpha/b.png',
      '/packs/zeta/c.png',
    ]);

    expect(keys).toEqual(['meetropolis:asset-pack:alpha', 'meetropolis:asset-pack:zeta']);
  });
});
