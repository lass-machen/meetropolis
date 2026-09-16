import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import catalogData from '../../../packages/shared/sprite/catalog.json';
import { ConfigSchema } from '../../../apps/server/src/api/routes/assetPacks.schemas.ts';
import { assetDefinitions, buildAssets, directionalAssets, themes, type ThemeId } from '../src/assets.ts';
import { characterSheet, defaultCharacter, faceNames, hairNames, hairColors, parseCharacter } from '../src/avatar.ts';
import { newDraft, draftAssets, parseDraft } from '../src/draft.ts';
import { packZip, officeRecipe } from '../src/pack.ts';
import { collisions, canStand, move, findPath, roomImage } from '../src/world.ts';
import { officePresets } from '../src/office-presets.ts';

const hash = (data: Uint8ClampedArray): string => createHash('sha256').update(data).digest('hex');
const alpha = (data: Uint8ClampedArray): Uint8ClampedArray => data.filter((_, i) => i % 4 === 3);
const frame = (data: Uint8ClampedArray, row: number, col = 0): Uint8ClampedArray => {
  const result = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    result.set(
      data.subarray(((row * 32 + y) * 128 + col * 32) * 4, ((row * 32 + y) * 128 + col * 32 + 32) * 4),
      y * 32 * 4,
    );
  return result;
};

describe('Pixelassets und bestehendes Packformat', () => {
  for (const theme of Object.keys(themes) as ThemeId[]) {
    it(`${theme}: reproduzierbare Pixel, binäres Alpha und unveränderte Silhouetten`, () => {
      const assets = buildAssets(theme);
      const repeat = buildAssets(theme);
      const base = buildAssets('holz');
      for (const [id, pixels] of Object.entries(assets)) {
        expect(hash(pixels.data)).toBe(hash(repeat[id as keyof typeof assets].data));
        expect(new Set(alpha(pixels.data))).not.toContain(128);
        expect([...new Set(alpha(pixels.data))].every((n) => n === 0 || n === 255)).toBe(true);
        expect(pixels.data.some((n) => n > 0)).toBe(true);
        expect(alpha(pixels.data)).toEqual(alpha(base[id as keyof typeof assets].data));
      }
      expect(roomImage(theme, assets, officePresets.loft).width).toBe(officePresets.loft.world.width);
      expect(roomImage(theme, assets, officePresets.loft).height).toBe(officePresets.loft.world.height);
    });

    it(`${theme}: echte PNGs im ZIP bestehen das aktuelle Server-Schema`, async () => {
      const assets = buildAssets(theme);
      const encode = (id: keyof typeof assets): Uint8Array => {
        const pixels = assets[id];
        const image = new PNG({ width: pixels.width, height: pixels.height });
        image.data = Buffer.from(pixels.data);
        return PNG.sync.write(image);
      };
      const bytes = await packZip(theme, assets, encode);
      expect(await packZip(theme, assets, encode)).toEqual(bytes);
      const zip = await JSZip.loadAsync(bytes);
      const config = ConfigSchema.parse(JSON.parse(await zip.file('config.json')!.async('string')));
      expect(Object.keys(zip.files)).toHaveLength(Object.keys(assetDefinitions).length + 1);
      const items = [...config.terrain, ...config.structures, ...config.objects, ...config.autotiles];
      expect(items).toHaveLength(Object.keys(assetDefinitions).length);
      for (const [id, family] of Object.entries(directionalAssets)) {
        const item = config.objects.find((item) => item.id === `atelier_${theme}_${id}`)!;
        expect(item.rotationAllowed).toBe(true);
        expect(item.directionalImages).toHaveLength(4);
        for (const variant of item.directionalImages!) {
          const assetId = family[variant.rotation];
          expect(variant.dataURL).toBe(`assets/${assetId}.png`);
          const png = PNG.sync.read(await zip.file(variant.dataURL)!.async('nodebuffer'));
          expect(png.data).toEqual(Buffer.from(assets[assetId].data));
        }
      }
      for (const item of items) {
        const image = PNG.sync.read(await zip.file(item.dataURL)!.async('nodebuffer'));
        const id = item.dataURL.slice(7, -4) as keyof typeof assets;
        expect(image.width).toBe(assets[id].width);
        expect(image.height).toBe(assets[id].height);
        expect(Buffer.from(image.data)).toEqual(Buffer.from(assets[id].data));
        if (item.category !== 'autotile') {
          expect(item.collisionBaseHeight).toBe(assetDefinitions[id].collisionBaseRows);
        } else {
          expect(item.tileWidth).toBe(16);
          expect(item.tileHeight).toBe(48);
          expect(item.gridHeight).toBe(3);
          expect(Object.keys(item.variants)).toHaveLength(16);
          for (const [mask, cell] of Object.entries(item.variants)) {
            expect(cell.col * 16 + 16).toBeLessThanOrEqual(image.width);
            expect(cell.row * 48 + 48).toBeLessThanOrEqual(image.height);
            expect(cell.row * 4 + cell.col).toBe(Number(mask));
          }
        }
      }
      expect(Object.keys(zip.files).every((path) => path === 'config.json' || path.startsWith('assets/'))).toBe(true);
    });
  }
});

describe('Office-Rezepte', () => {
  it('erhält beim Einlesen älterer Rezepte Figur, Farben und Pixel', () => {
    const original = newDraft();
    original.theme = 'abend';
    original.character.skin = 'dark';
    original.edits = { holz: { desk: { '0,0': '#ff00aa' } } };
    const { office: _office, ...old } = original;
    expect(_office).toBe('loft');
    const migrated = parseDraft(JSON.stringify({ ...old, schema: 'meetropolis-asset-lab/v1' }));
    expect(migrated).toEqual(original);
  });
  it('exportiert den gewählten Grundriss mit eigenen Maßen, Zonen und Kollisionen', () => {
    for (const office of Object.values(officePresets)) {
      const draft = {
        ...newDraft(),
        office: office.id,
        theme: office.defaultTheme,
      };
      expect(parseDraft(JSON.stringify(draft))).toEqual(draft);
      expect(officeRecipe(draft)).toMatchObject({
        schema: 'meetropolis-office-study/v2',
        ...office,
        theme: office.defaultTheme,
      });
    }
  });
});

describe('Modulare Figur', () => {
  it('alle angebotenen Frisuren und Gesichter erzeugen die 20 belegten Animationsframes', () => {
    for (const hair of Object.keys(hairNames))
      for (const face of Object.keys(faceNames) as (keyof typeof faceNames)[]) {
        const sheet = characterSheet({ ...defaultCharacter, hair, face });
        expect([sheet.width, sheet.height]).toEqual([128, 256]);
        for (let row = 0; row < 8; row++)
          for (let col = 0; col < 4; col++) {
            const filled = alpha(frame(sheet.data, row, col)).some((n) => n === 255);
            expect(filled).toBe(row >= 4 || col === 0);
          }
      }
  });

  it('alle Haarfarben passen auch zu allen angebotenen Bärten', () => {
    for (const color of Object.keys(hairColors))
      for (const beard of ['schnauzer', 'vollbart', 'ziegenbart']) {
        const character = parseCharacter({
          ...defaultCharacter,
          hair_color: color,
          beard_color: color,
          beard,
        });
        expect(characterSheet(character).data.some((n) => n === 255)).toBe(true);
      }
  });

  it('Haut, Kleidung, Hüte und Brillen verändern die echte Ausgabe', () => {
    const original = hash(characterSheet(defaultCharacter).data);
    const variants = [
      { skin: 'dark' },
      { outfit: 'dress', top: 'dress_red' },
      { top: 'shirt_white' },
      ...['cap', 'cowboy', 'zylinder', 'krone', 'diadem', 'hood'].map((hat) => ({ hat })),
      ...['rect', 'round', 'prof'].map((glasses) => ({ glasses })),
    ];
    for (const variant of variants)
      expect(hash(characterSheet(parseCharacter({ ...defaultCharacter, ...variant })).data)).not.toBe(original);
  });

  it('Gesicht folgt dem Kopf, ohne die Rückansicht zu verändern', () => {
    const sheets = Object.keys(faceNames).map((face) =>
      characterSheet({
        ...defaultCharacter,
        face: face as keyof typeof faceNames,
      }),
    );
    expect(new Set(sheets.map((sheet) => hash(frame(sheet.data, 0)))).size).toBe(3);
    expect(new Set(sheets.map((sheet) => hash(frame(sheet.data, 3)))).size).toBe(1);
    const data = sheets[0].data;
    expect(hash(frame(data, 4, 0))).not.toBe(hash(frame(data, 4, 2)));
    for (const row of [1, 5])
      for (let col = 0; col < (row === 1 ? 1 : 4); col++) {
        const left = frame(data, row, col);
        const right = frame(data, row + 1, col);
        for (let y = 0; y < 32; y++)
          for (let x = 0; x < 32; x++)
            expect([...right.slice((y * 32 + x) * 4, (y * 32 + x + 1) * 4)]).toEqual([
              ...left.slice((y * 32 + 31 - x) * 4, (y * 32 + 32 - x) * 4),
            ]);
      }
  });

  it('lokale Erweiterungen verändern den gemeinsamen Katalog nicht', () => {
    expect(catalogData.compose.base_kit.face_front).toBe('bodies.face.front');
    expect(catalogData.compose.config_fields.beard_color.values).not.toContain('rot');
  });
});

describe('Raum und Laufwege', () => {
  const office = officePresets.loft;
  const { spawn, zones, placements, bounds } = office;
  const obstacles = collisions(office, buildAssets('holz'));
  it('Start und alle Gesprächsbereiche sind erreichbar', () => {
    expect(canStand(spawn, obstacles, bounds)).toBe(true);
    for (const zone of zones) {
      const destination = zone.entry;
      const path = findPath(spawn, destination, obstacles, bounds);
      expect(path.length).toBeGreaterThan(0);
      let position = spawn;
      for (const next of path) {
        position = move(position, { x: next.x - position.x, y: next.y - position.y }, obstacles, bounds);
        expect(canStand(position, obstacles, bounds)).toBe(true);
      }
      expect(position).toEqual(destination);
    }
  });
  it('führt hinter den Schreibtisch und um seine Kollisionsfläche herum', () => {
    const desk = placements.find((item) => item.asset === 'compact_desk')!;
    const start = office.workplaces.find((item) => item.id === desk.id)!.approach;
    const target = { x: desk.x + 32, y: desk.y + 8 };
    const path = findPath(start, target, obstacles, bounds);
    expect(path.length).toBeGreaterThan(0);
    expect(path.some((p) => p.x <= desk.x - 5 || p.x >= desk.x + 53)).toBe(true);
    expect(path.at(-1)).toEqual(target);
  });
  it('durchquert auch bei großen Schritten keine Wand und keine Möbel', () => {
    expect(move(spawn, { x: 1000, y: 0 }, obstacles, bounds).x).toBeLessThanOrEqual(bounds.x + bounds.w - 5);
    const item = placements.find((item) => item.asset === 'compact_table')!;
    const start = { x: item.x + 24, y: item.y + 96 };
    expect(move(start, { x: 0, y: -250 }, obstacles, bounds).y).toBeGreaterThanOrEqual(item.y + 32 + 3);
    expect(findPath(spawn, { x: item.x + 24, y: item.y + 25 }, obstacles, bounds)).toEqual([]);
  });
});

describe('Rezept und manuelle Pixel', () => {
  it('stellt Farbe, Transparenz und Stil über einen JSON-Rundlauf identisch wieder her', () => {
    const draft = newDraft();
    draft.edits.holz = { desk: { '0,0': '#ff00aa', '20,10': null } };
    const restored = parseDraft(JSON.stringify(draft));
    const pixels = draftAssets(restored).desk;
    expect([...pixels.data.slice(0, 4)]).toEqual([255, 0, 170, 255]);
    expect(pixels.data[(10 * 64 + 20) * 4 + 3]).toBe(0);
    expect(pixels.data).toEqual(draftAssets(draft).desk.data);
    expect(draftAssets(restored, 'garten').desk.data).toEqual(buildAssets('garten').desk.data);
  });
  it('weist defekte und unbekannte importierte Werte zurück', () => {
    for (const patch of [
      { schema: 'unbekannt' },
      { theme: '__proto__' },
      { office: '__proto__' },
      { office: 'unknown' },
      { character: { ...defaultCharacter, hair: 'unbekannt' } },
      { edits: { holz: { desk: { '64,0': '#ff0000' } } } },
      { edits: { holz: { desk: { '-1,0': '#ff0000' } } } },
      { edits: { holz: { desk: { '0,0': 'red' } } } },
      { edits: { holz: { unknown: {} } } },
    ])
      expect(() => parseDraft(JSON.stringify({ ...newDraft(), ...patch }))).toThrow();
  });
});
