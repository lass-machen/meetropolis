import { roomSprites } from '../src/world.ts';
import { officePresets } from '../src/office-presets.ts';
import { Pixels } from '../src/pixels.ts';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assetDefinitions, buildAssets, directionalAssets, themes, type AssetId, type ThemeId } from '../src/assets.ts';

const hash = (data: Uint8ClampedArray): string => createHash('sha256').update(data).digest('hex');

function cell(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  cellWidth: number,
  cellHeight: number,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(cellWidth * cellHeight * 4);
  for (let row = 0; row < cellHeight; row++) {
    result.set(
      data.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + cellWidth) * 4),
      row * cellWidth * 4,
    );
  }
  return result;
}

function rgbaFromHex(hex: string): number[] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

function pixel(data: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  return [...data.slice((y * width + x) * 4, (y * width + x + 1) * 4)];
}

function alphaAt(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  return data[(y * width + x) * 4 + 3];
}

describe('Office-Pixelbausteine', () => {
  it('exportiert die drei Richtungsfamilien mit echten, unterschiedlichen Ansichten', () => {
    expect(directionalAssets).toMatchObject({
      desk: { 0: 'desk', 90: 'desk_east', 180: 'desk_north', 270: 'desk_west' },
      chair: {
        0: 'chair',
        90: 'chair_east',
        180: 'chair_north',
        270: 'chair_west',
      },
      sofa: {
        0: 'sofa',
        90: 'sofa_east',
        180: 'sofa_north',
        270: 'sofa_west',
      },
    });

    const expectedSizes: Record<string, [number, number]> = {
      desk: [64, 48],
      desk_east: [48, 64],
      desk_north: [64, 48],
      desk_west: [48, 64],
      chair: [24, 32],
      chair_east: [32, 40],
      chair_north: [24, 32],
      chair_west: [32, 40],
      sofa: [64, 40],
      sofa_east: [48, 48],
      sofa_north: [64, 40],
      sofa_west: [48, 48],
    };

    for (const theme of Object.keys(themes) as ThemeId[]) {
      const assets = buildAssets(theme);
      for (const [id, [width, height]] of Object.entries(expectedSizes)) {
        const pixels = assets[id as AssetId];
        expect([pixels.width, pixels.height]).toEqual([width, height]);
        const alpha = pixels.data.filter((_, index) => index % 4 === 3);
        expect([...new Set(alpha)].every((value) => value === 0 || value === 255)).toBe(true);
        expect([...alpha].some((value) => value === 0)).toBe(true);
        expect([...alpha].some((value) => value === 255)).toBe(true);
      }
      for (const family of Object.values(directionalAssets)) {
        const ids = Object.values(family) as AssetId[];
        expect(new Set(ids.map((id) => hash(assets[id].data))).size).toBe(4);
      }
    }
  });

  it('hält je Richtung die ausdrücklich definierte Standfläche ein', () => {
    const expectedRows: Record<string, number> = {
      desk: 2,
      desk_east: 2,
      desk_north: 2,
      desk_west: 2,
      chair: 1,
      chair_east: 1,
      chair_north: 1,
      chair_west: 1,
      sofa: 2,
      sofa_east: 2,
      sofa_north: 2,
      sofa_west: 2,
    };
    for (const [id, rows] of Object.entries(expectedRows))
      expect(assetDefinitions[id as AssetId].collisionBaseRows).toBe(rows);
  });

  it('hält bei Seitenansichten Platte, Rückseite und Sitztiefe als echte Geometrie fest', () => {
    const assets = buildAssets('holz');
    // Unterhalb der Platte darf in beiden Seitenansichten keine schwebende
    // Lücke entstehen; die Blende trägt bis zu den Stützen durch.
    expect(alphaAt(assets.desk_east.data, assets.desk_east.width, 24, 40)).toBe(255);
    expect(alphaAt(assets.desk_east.data, assets.desk_east.width, 24, 48)).toBe(255);
    expect(alphaAt(assets.desk_west.data, assets.desk_west.width, 24, 40)).toBe(255);
    expect(alphaAt(assets.desk_west.data, assets.desk_west.width, 24, 48)).toBe(255);
    for (const x of [8, 56]) for (let y = 30; y < 46; y++) expect(alphaAt(assets.desk_north.data, 64, x, y)).toBe(255);
    // Die Rückseite trägt ein Gehäuse mit Mittelsteg, keine Front-Displayzeilen.
    expect(pixel(assets.desk_north.data, assets.desk_north.width, 24, 8)).toEqual(rgbaFromHex('#344a48'));
    expect(pixel(assets.desk_north.data, assets.desk_north.width, 32, 8)).toEqual(rgbaFromHex('#7d9389'));
    // Rückenlehne und Armauflage liegen bei Ost/West jeweils an der Seite;
    // die Sitzfläche zieht sich in die entgegengesetzte Richtung.
    expect(alphaAt(assets.chair_east.data, assets.chair_east.width, 7, 10)).toBe(255);
    expect(alphaAt(assets.chair_east.data, assets.chair_east.width, 25, 25)).toBe(255);
    expect(alphaAt(assets.chair_west.data, assets.chair_west.width, 20, 10)).toBe(255);
    expect(alphaAt(assets.chair_west.data, assets.chair_west.width, 6, 25)).toBe(255);
    expect(alphaAt(assets.sofa_east.data, assets.sofa_east.width, 7, 12)).toBe(255);
    expect(alphaAt(assets.sofa_east.data, assets.sofa_east.width, 38, 25)).toBe(255);
    expect(alphaAt(assets.sofa_west.data, assets.sofa_west.width, 38, 12)).toBe(255);
    expect(alphaAt(assets.sofa_west.data, assets.sofa_west.width, 9, 25)).toBe(255);
  });

  it('schließt alle Eckpixel und führt Lichtlinien über verbundene Kanten fort', () => {
    for (const theme of Object.keys(themes) as ThemeId[]) {
      const atlas = buildAssets(theme).wall_set;
      const trim = rgbaFromHex(themes[theme].trim),
        light = rgbaFromHex(themes[theme].woodLight);
      for (let mask = 0; mask < 16; mask++) {
        const x = (mask & 3) * 16,
          y = (mask >> 2) * 48;
        if (!(mask & 8))
          for (let dy = 0; dy < 48; dy++) expect(pixel(atlas.data, atlas.width, x, y + dy)).toEqual(trim);
        if (!(mask & 2))
          for (let dy = 0; dy < 48; dy++) expect(pixel(atlas.data, atlas.width, x + 15, y + dy)).toEqual(trim);
        if (!(mask & 1))
          for (let dx = 0; dx < 16; dx++) expect(pixel(atlas.data, atlas.width, x + dx, y)).toEqual(trim);
        if (!(mask & 4))
          for (let dx = 0; dx < 16; dx++) expect(pixel(atlas.data, atlas.width, x + dx, y + 47)).toEqual(trim);
        if (!(mask & 1) && mask & 2) expect(pixel(atlas.data, atlas.width, x + 15, y + 3)).toEqual(light);
        if (!(mask & 1) && mask & 8) expect(pixel(atlas.data, atlas.width, x, y + 3)).toEqual(light);
        if (!(mask & 4) && mask & 2) expect(pixel(atlas.data, atlas.width, x + 15, y + 44)).toEqual(light);
        if (!(mask & 4) && mask & 8) expect(pixel(atlas.data, atlas.width, x, y + 44)).toEqual(light);
      }
    }
  });

  it('zeichnet den 64×192-Wandatlas mit allen 16 eigenständigen Maskenzellen', () => {
    for (const theme of Object.keys(themes) as ThemeId[]) {
      const atlas = buildAssets(theme).wall_set;
      expect([atlas.width, atlas.height]).toEqual([64, 192]);
      const cells = Array.from({ length: 16 }, (_, mask) =>
        cell(atlas.data, atlas.width, (mask & 3) * 16, (mask >> 2) * 48, 16, 48),
      );
      expect(new Set(cells.map(hash)).size).toBe(16);
      expect(assetDefinitions.wall_set.collisionBaseRows).toBe(0);
      expect([...cells[0]].some((value) => value !== 0)).toBe(true);
      // Die Zellen bleiben an den Atlasgrenzen getrennt; die jeweils erste
      // Spalte/Zeile wird aus ihrer eigenen Position gelesen.
      expect(pixel(atlas.data, atlas.width, 8, 0)).toEqual(rgbaFromHex(themes[theme].trim));
      expect(pixel(atlas.data, atlas.width, 24, 0)).toEqual(rgbaFromHex(themes[theme].wall));
      expect(cell(atlas.data, atlas.width, 0, 0, 16, 1)).not.toEqual(cell(atlas.data, atlas.width, 16, 0, 16, 1));
      expect(cell(atlas.data, atlas.width, 0, 47, 16, 1)).not.toEqual(cell(atlas.data, atlas.width, 0, 95, 16, 1));
      for (let mask = 0; mask < 16; mask++) {
        const x = (mask & 3) * 16;
        const y = (mask >> 2) * 48;
        const connected = rgbaFromHex(themes[theme].wall);
        const trim = rgbaFromHex(themes[theme].trim);
        // E/W-Anschlüsse führen die Wandfläche über die Zellgrenze. Eine
        // Trim-Naht darf nur an einer tatsächlich offenen Seite liegen.
        expect(pixel(atlas.data, atlas.width, x + 15, y + 18)).toEqual(mask & 2 ? connected : trim);
        expect(pixel(atlas.data, atlas.width, x, y + 18)).toEqual(mask & 8 ? connected : trim);
      }
      expect(hash(cells[0])).not.toBe(hash(cells[1]));
      expect(hash(cells[0])).not.toBe(hash(cells[4]));
      expect(hash(cells[1])).not.toBe(hash(cells[2]));
    }
  });

  it('zeichnet senkrechte und waagerechte Wandzüge ohne unterbrochene Kanten', () => {
    for (const theme of Object.keys(themes) as ThemeId[]) {
      const assets = buildAssets(theme);
      const office = {
        ...officePresets.loft,
        placements: [],
        walls: [
          { x: 64, y: 112 },
          { x: 64, y: 128 },
          { x: 64, y: 144 },
          { x: 64, y: 160 },
          { x: 96, y: 208 },
          { x: 112, y: 208 },
          { x: 128, y: 208 },
        ],
      };
      const image = new Pixels(192, 256);
      for (const sprite of roomSprites(office, assets)) image.stamp(sprite.pixels, sprite.x, sprite.y);
      const trim = rgbaFromHex(themes[theme].trim);
      for (let y = 80; y < 169; y++) {
        expect(pixel(image.data, image.width, 64, y)).toEqual(trim);
        expect(pixel(image.data, image.width, 79, y)).toEqual(trim);
      }
      for (let x = 96; x < 144; x++) {
        expect(pixel(image.data, image.width, x, 176)).toEqual(trim);
        expect(pixel(image.data, image.width, x, 223)).toEqual(trim);
      }
    }
  });

  it('liefert passierbare Türöffnung und ruhige Zusatzdetails mit korrekten Maßen', () => {
    const assets = buildAssets('holz');
    expect([assets.door_open.width, assets.door_open.height]).toEqual([32, 48]);
    expect(assetDefinitions.door_open.collisionBaseRows).toBe(0);
    expect(assets.door_open.data[(20 * 32 + 16) * 4 + 3]).toBe(0);

    expect([assets.planter.width, assets.planter.height]).toEqual([48, 48]);
    expect([assets.bench.width, assets.bench.height]).toEqual([64, 32]);
    expect([assets.plant_small.width, assets.plant_small.height]).toEqual([16, 32]);
    expect(assetDefinitions.planter.collisionBaseRows).toBe(1);
    expect(assetDefinitions.bench.collisionBaseRows).toBe(1);
    expect(assetDefinitions.plant_small.collisionBaseRows).toBe(1);
  });
});
