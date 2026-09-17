import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  characterSheet,
  defaultCharacter,
  parseCharacter,
  hairNames,
  extraHatNames,
  extraBeardNames,
  compactLooks,
  type Character,
} from '../src/avatar.ts';
import { newDraft, parseDraft, draftAssets } from '../src/draft.ts';
import { buildAssets, assetCollisionFootprint, directionalAssets } from '../src/assets.ts';
import { compactOfficeAssets } from '../src/office-compact.ts';
import { officeList } from '../src/office-presets.ts';
import { prepareRoom, flattenRoom, roomImage } from '../src/world.ts';

const bodies = ['kompakt'] as const;
const hash = (data: Uint8ClampedArray) => createHash('sha256').update(data).digest('hex');
const pixel = (data: Uint8ClampedArray, x: number, y: number) => [
  ...data.slice((y * 128 + x) * 4, (y * 128 + x + 1) * 4),
];

describe('Ausbau des kompakten Baukastens', () => {
  it('zeigt den kompakten Körper auch ohne Haare und Zubehör', () => {
    for (const outfit of ['base', 'trousers', 'dress']) {
      const sheets = bodies.map((proportion) =>
        characterSheet({
          ...defaultCharacter,
          proportion,
          hair: 'bald',
          outfit,
          top: outfit === 'base' ? null : outfit === 'dress' ? 'dress_red' : 'shirt_white',
        }),
      );
      for (let row = 0; row < 4; row++) {
        const hashes = sheets.map((sheet) => hash(sheet.data.slice(row * 32 * 128 * 4, (row + 1) * 32 * 128 * 4)));
        expect(new Set(hashes).size).toBe(1);
      }
    }
  });
  it('Kinn und Kleidung teilen sich eine mittige, ununterbrochene Halsöffnung', () => {
    for (const proportion of bodies)
      for (const skin of ['light', 'medium', 'tan', 'dark']) {
        const base = { ...defaultCharacter, proportion, skin, hair: 'bald' };
        const bare = characterSheet({ ...base, outfit: 'base', top: null });
        for (const top of ['shirt_white', 'hoodie_blue', 'suit_navy', 'blazer_anthracite', 'dress_red']) {
          const dressed = characterSheet({
            ...base,
            top,
            outfit: top === 'dress_red' ? 'dress' : 'trousers',
          });
          for (const y of [18, 19])
            for (const x of [15, 16]) {
              expect(pixel(dressed.data, x, y)).toEqual(pixel(bare.data, x, y));
              expect(pixel(dressed.data, x, y)).not.toEqual([64, 53, 72, 255]);
            }
        }
      }
  });
  it.each(bodies)('%s: alle neuen Hüte sind mit jeder Frisur animierbar', (proportion) => {
    for (const hat of Object.keys(extraHatNames))
      for (const hair of Object.keys(hairNames)) {
        const sheet = characterSheet(parseCharacter({ ...defaultCharacter, proportion, hat, hair }));
        for (let row = 0; row < 8; row++)
          for (let col = 0; col < (row < 4 ? 1 : 4); col++) {
            let visible = 0;
            for (let y = 0; y < 32; y++)
              for (let x = 0; x < 32; x++) {
                const a = sheet.data[((row * 32 + y) * 128 + col * 32 + x) * 4 + 3];
                if (a) visible++;
                if (x === 0 || x === 31) expect(a).toBe(0);
              }
            expect(visible).toBeGreaterThan(100);
          }
      }
  });
  it('neue Bärte sind unterscheidbar und lassen den animierten Mund lesbar', () => {
    for (const proportion of bodies)
      for (const face of ['ruhig', 'freundlich', 'wach'] as const) {
        const config: Character = {
          ...defaultCharacter,
          proportion,
          face,
          hair: 'bald',
        };
        const bare = characterSheet(config);
        const sheets = Object.keys(extraBeardNames).map((beard) =>
          characterSheet(parseCharacter({ ...config, beard })),
        );
        expect(new Set(sheets.map((sheet) => hash(sheet.data))).size).toBe(4);
        for (let i = 0; i < bare.data.length; i += 4) {
          if (bare.data[i] === 179 && bare.data[i + 1] === 109 && bare.data[i + 2] === 105) {
            for (const sheet of sheets) expect([...sheet.data.slice(i, i + 4)]).toEqual([...bare.data.slice(i, i + 4)]);
          }
        }
      }
  });
  it('Startlooks und neue Kombinationen überleben das tatsächliche Rezeptformat', () => {
    for (const look of Object.values(compactLooks)) {
      const draft = newDraft();
      draft.character = { ...draft.character, ...look.character };
      const restored = parseDraft(JSON.stringify(draft));
      expect(restored.character).toEqual(draft.character);
      expect(characterSheet(restored.character).data).toEqual(characterSheet(draft.character).data);
    }
    const old = newDraft();
    old.edits.holz = { desk: { '63,47': '#ff00aa' } };
    expect(draftAssets(parseDraft(JSON.stringify(old))).desk.data.slice(-4)).toEqual(
      new Uint8ClampedArray([255, 0, 170, 255]),
    );
  });
  it('kleine Möbel haben ganze Standkacheln innerhalb ihrer Bildgrenzen', () => {
    const assets = buildAssets('holz');
    expect([assets.compact_desk.width, assets.compact_desk.height]).toEqual([48, 32]);
    for (const id of Object.keys(compactOfficeAssets) as (keyof typeof compactOfficeAssets)[]) {
      const image = assets[id],
        foot = assetCollisionFootprint(id, image)!;
      expect(foot.w).toBeLessThanOrEqual(image.width);
      expect(foot.y + foot.h).toBe(image.height);
      let visibleFoot = 0;
      for (let y = foot.y; y < image.height; y++)
        for (let x = 0; x < foot.w; x++) visibleFoot += Number(image.data[(y * image.width + x) * 4 + 3] > 0);
      expect(visibleFoot).toBeGreaterThan(12);
    }
    for (const family of ['compact_desk', 'compact_chair', 'compact_sofa'] as const) {
      expect(new Set(Object.values(directionalAssets[family]).map((id) => hash(assets[id].data))).size).toBe(4);
    }
  });
  it('Szene und Raumprobe teilen dieselben Pixel ohne den Hintergrund zu verändern', () => {
    for (const office of officeList) {
      const assets = buildAssets(office.defaultTheme);
      const render = prepareRoom(office.defaultTheme, assets, office);
      const before = hash(render.background.data);
      const image = flattenRoom(render);
      expect(hash(render.background.data)).toBe(before);
      expect(Buffer.from(image.data).equals(Buffer.from(roomImage(office.defaultTheme, assets, office).data))).toBe(
        true,
      );
    }
  });
});
