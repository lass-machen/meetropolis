import { describe, expect, it } from 'vitest';
import { characterSheet, defaultCharacter } from '../src/avatar.ts';
import catalogData from '../../../packages/shared/sprite/catalog.json';
import { assertSpriteCatalog } from '../../../packages/shared/src/sprite/index.ts';
import type { Grid } from '../../../packages/shared/src/sprite/types.ts';
import { createProportionCatalog } from '../src/avatar-proportions.ts';
const character = { ...defaultCharacter, proportion: 'kompakt' as const };
const pixel = (image: ReturnType<typeof characterSheet>, x: number, y: number) =>
  Array.from(image.data.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4));
describe('Zubehör auf dem kompakten Gesicht', () => {
  it('Bob und lange Haare schließen ohne seitlichen Versatz an die Haarkappe an', () => {
    for (const covered of [false, true]) {
      const catalog = createProportionCatalog(assertSpriteCatalog(catalogData), 'kompakt', covered);
      const hairstyles = catalog.catalogs.hairstyles as Record<string, Record<string, Grid>>;
      for (const hair of ['bob', 'long']) {
        const end = hair === 'bob' ? 19 : 24;
        for (const view of ['front', 'rear']) {
          const rows = hairstyles[hair][view];
          for (let y = 12; y < end; y++) {
            const bounds = (row: string) => [row.search(/[^.]/), row.search(/[^.]\.*$/)];
            const before = bounds(rows[y - 1]),
              after = bounds(rows[y]);
            expect(Math.abs(after[0] - before[0]), `${hair}/${view}: linke Kante ${y}`).toBeLessThanOrEqual(1);
            expect(Math.abs(after[1] - before[1]), `${hair}/${view}: rechte Kante ${y}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
  it('verlängerte Seitenhaare enthalten keine innere Abschlussnaht der kurzen Frisur', () => {
    const catalog = createProportionCatalog(assertSpriteCatalog(catalogData), 'kompakt', false);
    const hairstyles = catalog.catalogs.hairstyles as Record<string, Record<string, Grid>>;
    for (const hair of ['bob', 'long']) {
      const end = hair === 'bob' ? 19 : 24;
      for (let y = 12; y < end - 2; y++) {
        const mass = hairstyles[hair].side[y].slice(15).replaceAll('.', '');
        expect(mass.length).toBeGreaterThan(5);
        expect(mass.at(-1)).toBe('O');
        expect(mass.slice(0, -1), `${hair}: innere Naht in Zeile ${y}`).not.toContain('O');
      }
    }
  });
  it('hält die Wangenkontur unter kurzen Haaren geschlossen', () => {
    for (const skin of ['light', 'medium', 'tan', 'dark'])
      for (const face of ['ruhig', 'freundlich', 'wach'] as const) {
        const image = characterSheet({
          ...character,
          skin,
          face,
          hair: 'messy',
          hair_color: 'blond',
        });
        for (let y = 12; y <= 16; y++) expect(pixel(image, 24, y)[3]).toBe(0);
        expect(pixel(image, 18, 13)[3]).toBe(255);
      }
  });
  it('Brillengestelle lassen die Augenlichter sichtbar', () => {
    for (const glasses of ['round', 'rect', 'prof']) {
      const image = characterSheet({
        ...character,
        hair: 'bald',
        face: 'wach',
        glasses,
      });
      expect(pixel(image, 13, 13)).toEqual([255, 240, 220, 255]);
      expect(pixel(image, 17, 13)).toEqual([255, 240, 220, 255]);
      expect(pixel(image, 12, 45)).toEqual([255, 240, 220, 255]);
    }
  });
  it('Zöpfe haben auch von hinten eine eigene geteilte Silhouette', () => {
    const a = characterSheet({ ...character, hair: 'braids' });
    const b = characterSheet({ ...character, hair: 'long' });
    expect(a.data.subarray(96 * 128 * 4, 128 * 128 * 4)).not.toEqual(b.data.subarray(96 * 128 * 4, 128 * 128 * 4));
  });
  it('Bärte erhalten die lesbare Mundposition in Front und Seitenansicht', () => {
    for (const face of ['ruhig', 'freundlich', 'wach'] as const)
      for (const skin of ['light', 'medium', 'tan', 'dark']) {
        const base = { ...character, face, skin, hair: 'bald' };
        const without = characterSheet(base);
        for (const beard of ['schnauzer', 'vollbart', 'ziegenbart']) {
          const image = characterSheet({ ...base, beard });
          // Jede sichtbare Mundmarkierung muss auch in allen Laufbildern erhalten bleiben.
          for (let i = 0; i < without.data.length; i += 4) {
            if (without.data[i] === 179 && without.data[i + 1] === 109 && without.data[i + 2] === 105)
              expect([...image.data.subarray(i, i + 4)]).toEqual([...without.data.subarray(i, i + 4)]);
          }
          expect(image.data).not.toEqual(without.data);
        }
      }
  });
});
