import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertSpriteCatalog } from './index.js';
import { composeSheet } from './sheet.js';
import type { AvatarConfig, RgbaImage } from './types.js';

const catalog = assertSpriteCatalog(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../sprite/catalog.json', import.meta.url)), 'utf8')),
);
const base: AvatarConfig = {
  skin: 'medium',
  hair: 'messy',
  hair_color: 'braun',
  outfit: 'trousers',
  top: 'hoodie_blue',
  pants: 'dark',
  shoes: 'brown',
  face: 'freundlich',
};

function frame(image: RgbaImage, row: number, col: number): Uint8Array {
  const bytes = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    const start = ((row * 32 + y) * image.width + col * 32) * 4;
    bytes.set(image.data.subarray(start, start + 32 * 4), y * 32 * 4);
  }
  return bytes;
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

describe('sprite catalog v6 proportions', () => {
  it('pins the compact figure in all four directions pixel-exactly', () => {
    const hashes: Record<string, string[]> = {};
    for (const proportion of catalog.compose.config_fields.proportion.values) {
      const image = composeSheet(catalog, { ...base, proportion });
      hashes[proportion] = [0, 1, 2, 3].map((row) => hash(frame(image, row, 0)));
    }
    expect(hashes).toEqual({
      kompakt: ['6e7896bc45beffb2', 'b7c8500d565c563c', '61a2179b130d4f66', '96faad148aff6325'],
    });
  });

  it('renders a complete four-frame walk cycle in every direction', () => {
    for (const proportion of catalog.compose.config_fields.proportion.values) {
      const image = composeSheet(catalog, { ...base, proportion });
      for (const row of [4, 5, 6, 7]) {
        const cycle = [0, 1, 2, 3].map((col) => frame(image, row, col));
        expect(
          cycle.every((pixels) => pixels.some((byte) => byte !== 0)),
          `${proportion}, row ${row}`,
        ).toBe(true);
        expect(new Set(cycle.map(hash)).size, `${proportion}, row ${row}`).toBeGreaterThan(1);
      }
    }
  });
});
