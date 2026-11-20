import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertSpriteCatalog, composeSheet, resolveSpriteCatalog } from '../../../packages/shared/src/sprite/index.ts';
import { getGrid } from '../../../packages/shared/src/sprite/sheet.ts';
import type { AvatarConfig, RgbaImage } from '../../../packages/shared/src/sprite/types.ts';

const catalog = assertSpriteCatalog(
  JSON.parse(readFileSync(new URL('../../../packages/shared/sprite/catalog.json', import.meta.url), 'utf8')),
);
const base: AvatarConfig = {
  skin: 'medium',
  hair: 'ponytail',
  hair_color: 'braun',
  outfit: 'trousers',
  top: 'hoodie_blue',
  pants: 'dark',
  shoes: 'brown',
  face: 'ruhig',
  proportion: 'kompakt',
};

function pixels(image: RgbaImage, row: number, col: number, mirrored = false): Uint8Array {
  const result = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const from = ((row * 32 + y) * image.width + col * 32 + x) * 4;
      result.set(image.data.subarray(from, from + 4), (y * 32 + (mirrored ? 31 - x : x)) * 4);
    }
  return result;
}

// Geometry rules for the direction and layer behavior of compact avatars.
// No snapshot update can allow a forbidden nose or braid area.
describe('direction and layer rules of the compact avatars', () => {
  for (const hat of [null, 'cap']) {
    const state = hat ? 'covered' : 'uncovered';
    it(`${state}: the back-tied ponytail stays at the front, behind the head`, () => {
      const config = { ...base, hat };
      const resolved = resolveSpriteCatalog(catalog, config);
      expect(getGrid(resolved, 'hairstyles.ponytail.front', config)).toEqual(
        getGrid(resolved, 'hairstyles.messy.front', config),
      );
    });
    it(`${state}: the rear tail sits centered at the nape`, () => {
      const config = { ...base, hat };
      const resolved = resolveSpriteCatalog(catalog, config);
      const rear = getGrid(resolved, 'hairstyles.ponytail.rear', config);
      for (let y = 17; y <= 21; y++) {
        expect(rear[y].slice(13, 19).replaceAll('.', '').length, `Ansatz/Reihe ${y}`).toBeGreaterThan(0);
        expect(rear[y].slice(0, 13).replaceAll('.', '') + rear[y].slice(19).replaceAll('.', '')).toBe('');
      }
    });
    it(`${state}: the profile nose does not break the adjacent cheek outline`, () => {
      const config = { ...base, hat };
      const resolved = resolveSpriteCatalog(catalog, config);
      const head = getGrid(resolved, 'bodies.body.side', config);
      const cheek = head[12].search(/[^.]/);
      expect(head[13].search(/[^.]/)).toBe(cheek);
      expect(head[14].search(/[^.]/)).toBe(cheek);
    });
  }

  it('draws face, beard and glasses only on the visible side of the head', () => {
    const resolved = resolveSpriteCatalog(catalog, base);
    const rearSlots = resolved.compose.part_layout.rear.map((part) => part.slot);
    expect(rearSlots.some((slot) => /^(face|beard|glasses)_/.test(slot))).toBe(false);
    for (const misc of ['schnuller', 'zigarette']) {
      expect(getGrid(resolved, `misc.${misc}.rear`, base).every((row) => /^\.+$/.test(row))).toBe(true);
    }
    for (const view of ['front', 'side', 'rear'] as const) {
      const layout = resolved.compose.part_layout[view];
      for (const part of layout.filter((entry) => /^(body|face|beard|glasses|hair|hat|misc)_/.test(entry.slot))) {
        expect(part.dy, `${view}/${part.slot}`).toEqual(['bob']);
        expect(part.dx, `${view}/${part.slot}`).toEqual([]);
      }
    }
  });

  it.each(catalog.compose.config_fields.skin.values)(
    '%s: keeps all hair-hat combinations on the grid and mirrors every idle/walk frame exactly',
    (skin) => {
      for (const hair of catalog.compose.config_fields.hair.values)
        for (const hat of [null, ...catalog.compose.config_fields.hat.values]) {
          const image = composeSheet(catalog, { ...base, skin, hair, hat });
          const label = `${skin}/${hair}/${hat ?? 'no hat'}`;
          expect([image.width, image.height], label).toEqual([128, 256]);
          for (let phase = 0; phase < 5; phase++) {
            const row = phase === 0 ? 1 : 5;
            const col = phase === 0 ? 0 : phase - 1;
            expect(
              Buffer.from(pixels(image, row + 1, col)).equals(Buffer.from(pixels(image, row, col, true))),
              label,
            ).toBe(true);
          }
          let outside = 0;
          let partialAlpha = 0;
          for (let y = 0; y < image.height; y++)
            for (let x = 0; x < image.width; x++) {
              const alpha = image.data[(y * image.width + x) * 4 + 3];
              if (alpha !== 0 && alpha !== 255) partialAlpha++;
              if ((x % 32 === 0 || x % 32 === 31) && alpha) outside++;
            }
          expect(outside, label).toBe(0);
          expect(partialAlpha, label).toBe(0);
        }
    },
  );
});
