import { describe, expect, it } from 'vitest';
import { normalizeTilesetImageUrl } from './tilesetImageUrl.js';

const GENERATION = '550e8400-e29b-44d4-a716-446655440000';

describe('normalizeTilesetImageUrl', () => {
  it.each([
    ['/assets/tilesets/office_floor.png', '/assets/tilesets/office_floor.png'],
    [
      `/packs/office-pack/generations/${GENERATION}/tiles.png`,
      `/packs/office-pack/generations/${GENERATION}/tiles.png`,
    ],
    ['/member-assets/v1/packs/office-pack/tiles.png', '/member-assets/v1/packs/office-pack/tiles.png'],
    // The desktop and web clients send absolute URLs with their API base.
    ['http://localhost:4000/assets/tilesets/office_floor.png', '/assets/tilesets/office_floor.png'],
    ['https://api.example.test/packs/office-pack/tiles.png', '/packs/office-pack/tiles.png'],
    // A foreign host only keeps the allowed path, so clients never fetch from it.
    ['https://tracker.example/packs/office-pack/tiles.png', '/packs/office-pack/tiles.png'],
  ])('stores %s as %s', (raw, expected) => {
    expect(normalizeTilesetImageUrl(raw)).toBe(expected);
  });

  it.each([
    'https://tracker.example/pixel.png',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'ftp://api.example.test/assets/tilesets/a.png',
    '//tracker.example/assets/tilesets/a.png',
    'assets/tilesets/a.png',
    '/other/a.png',
    '/packs/',
    '/packs/office-pack',
    '/assets/../secret.png',
    '/packs/../assets/a.png',
    '/assets/./a.png',
    '/assets/%2e%2e/secret.png',
    '/assets/%2E%2E%2Fsecret.png',
    '/packs/office-pack/..%2f..%2fsecret.png',
    '/assets/%5c..%5csecret.png',
    '/assets\\..\\secret.png',
    'https://api.example.test/assets/../packs/a.png',
    'https://api.example.test/assets/%2e%2e/secret.png',
    '/assets/a.png?track=1',
    '/assets/a.png#fragment',
    'https://api.example.test/assets/a.png?track=1',
    'https://api.example.test/assets/a.png#fragment',
    `/assets/${'a'.repeat(2048)}.png`,
  ])('rejects %s', (raw) => {
    expect(normalizeTilesetImageUrl(raw)).toBeNull();
  });
});
