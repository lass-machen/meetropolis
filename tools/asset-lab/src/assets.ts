import { compactOfficeAssets } from './office-compact.ts';
import { Pixels } from './pixels.ts';
import {
  bench,
  chairEast,
  chairNorth,
  chairWest,
  deskEast,
  deskNorth,
  deskWest,
  doorOpen,
  plantSmall,
  planter,
  sofaEast,
  sofaNorth,
  sofaWest,
  wallSet,
} from './office-art.ts';

export const TILE_SIZE = 16;

export const themes = {
  holz: {
    name: 'Licht & Holz',
    subtitle: 'Eiche, Salbei und Tageslicht',
    wood: '#bf8c58',
    woodLight: '#dfb781',
    woodShade: '#9f714b',
    woodDark: '#705039',
    floor: '#d9b88b',
    floorLight: '#e3c79f',
    floorShade: '#caa878',
    fabric: '#4f7465',
    fabricLight: '#70917c',
    fabricShade: '#36564c',
    carpet: '#abbfc2',
    carpetLight: '#bdcdd0',
    carpetShade: '#8ea8ad',
    wall: '#f4efdf',
    wallShade: '#ded6c3',
    trim: '#ae845a',
    accent: '#be7459',
    leaf: '#618652',
    leafLight: '#88a764',
    leafDark: '#395e45',
  },
  garten: {
    name: 'Grünes Studio',
    subtitle: 'Esche, Pflanzen und sanftes Grün',
    wood: '#c4ad7e',
    woodLight: '#e4d1a6',
    woodShade: '#a79063',
    woodDark: '#726648',
    floor: '#e0d6b9',
    floorLight: '#eee5cc',
    floorShade: '#cbc1a1',
    fabric: '#578268',
    fabricLight: '#7da087',
    fabricShade: '#3a624e',
    carpet: '#b2c1a4',
    carpetLight: '#cad5be',
    carpetShade: '#92a687',
    wall: '#f2f2e7',
    wallShade: '#dedfce',
    trim: '#869476',
    accent: '#d7956f',
    leaf: '#659256',
    leafLight: '#9cb871',
    leafDark: '#3d684e',
  },
  abend: {
    name: 'Abendatelier',
    subtitle: 'Nussbaum, Petrol und warme Akzente',
    wood: '#956447',
    woodLight: '#bc8c5d',
    woodShade: '#7c503c',
    woodDark: '#553c33',
    floor: '#a47a5c',
    floorLight: '#b58a65',
    floorShade: '#8e654f',
    fabric: '#b99146',
    fabricLight: '#d6b368',
    fabricShade: '#896a37',
    carpet: '#647c89',
    carpetLight: '#8096a0',
    carpetShade: '#496773',
    wall: '#b7c4c6',
    wallShade: '#95a8ae',
    trim: '#677a7e',
    accent: '#d1a466',
    leaf: '#61845e',
    leafLight: '#8ca26e',
    leafDark: '#3c5b4b',
  },
} as const;

export type ThemeId = keyof typeof themes;
export type Palette = { [K in keyof typeof themes.holz]: string };
export const INK = '#35433f';

function legs(p: Pixels, x: number, y: number, w: number, color: string): void {
  p.rect(x, y, 4, 8, color);
  p.rect(x + w - 4, y, 4, 8, color);
}

function mug(p: Pixels, x: number, y: number): void {
  p.rect(x, y, 5, 5, '#fcf4dc');
  p.rect(x + 5, y + 1, 2, 3, '#fcf4dc');
  p.rect(x + 1, y, 3, 1, '#73604e');
  p.rect(x, y + 4, 5, 1, '#c9c8b1');
}

function desk(c: Palette): Pixels {
  const p = new Pixels(64, 48);
  legs(p, 5, 38, 54, c.woodDark);
  p.rect(5, 26, 11, 15, c.woodShade);
  p.rect(48, 26, 11, 15, c.woodDark);
  p.rect(49, 28, 9, 5, c.wood);
  p.rect(49, 35, 9, 5, c.wood);
  p.rect(52, 30, 3, 1, c.woodDark);
  p.rect(52, 37, 3, 1, c.woodDark);
  p.box(0, 15, 64, 16, c.woodDark);
  p.rect(1, 15, 62, 11, c.wood);
  p.rect(2, 15, 60, 2, c.woodLight);
  p.rect(1, 26, 62, 3, c.woodShade);
  p.rect(4, 23, 11, 1, c.woodLight);
  p.rect(46, 20, 13, 1, c.woodShade);
  p.box(16, 1, 28, 18, INK);
  p.rect(18, 3, 24, 13, '#253b42');
  p.rect(19, 4, 22, 1, '#526d70');
  p.rect(21, 7, 7, 1, '#9bb3b0');
  p.rect(21, 10, 13, 1, '#71978f');
  p.rect(21, 12, 10, 1, '#58797c');
  p.rect(28, 19, 4, 2, INK);
  p.rect(24, 21, 12, 2, '#516362');
  p.box(18, 24, 22, 5, '#eee9d5');
  for (let x = 20; x < 38; x += 3) p.rect(x, 25, 1, 2, '#b9bba9');
  p.box(43, 24, 4, 5, '#dfdfcc');
  mug(p, 52, 19);
  return p;
}

function chair(c: Palette): Pixels {
  const p = new Pixels(24, 32);
  p.rect(11, 23, 3, 6, '#586564');
  p.rect(4, 28, 17, 2, INK);
  p.rect(3, 29, 4, 2, INK);
  p.rect(18, 29, 4, 2, INK);
  p.rect(11, 28, 3, 4, INK);
  p.box(4, 15, 16, 10, c.fabricShade, 2);
  p.box(5, 16, 14, 6, c.fabric, 2);
  p.rect(2, 15, 3, 9, INK);
  p.rect(20, 15, 3, 9, INK);
  p.box(3, 1, 18, 19, c.fabricShade, 3);
  p.box(5, 2, 14, 14, c.fabric, 2);
  p.rect(7, 2, 10, 2, c.fabricLight);
  p.rect(8, 16, 8, 2, c.fabricShade);
  return p;
}

function sofa(c: Palette): Pixels {
  const p = new Pixels(64, 40);
  legs(p, 7, 31, 50, c.woodDark);
  p.box(3, 2, 58, 26, c.fabricShade, 3);
  p.box(6, 3, 25, 18, c.fabric, 2);
  p.box(33, 3, 25, 18, c.fabric, 2);
  p.rect(8, 4, 21, 2, c.fabricLight);
  p.rect(35, 4, 21, 2, c.fabricLight);
  p.box(5, 20, 54, 14, c.fabricShade, 2);
  p.rect(9, 20, 22, 9, c.fabricLight);
  p.rect(33, 20, 22, 9, c.fabricLight);
  p.rect(9, 28, 46, 3, c.fabric);
  p.box(0, 15, 8, 18, c.fabricShade, 2);
  p.box(56, 15, 8, 18, c.fabricShade, 2);
  p.rect(1, 16, 6, 3, c.fabricLight);
  p.rect(57, 16, 6, 3, c.fabricLight);
  p.box(12, 11, 12, 12, '#e9daba', 2);
  p.rect(14, 11, 8, 2, '#fcf0d1');
  p.rect(13, 21, 9, 2, '#cabb9c');
  p.box(43, 13, 9, 10, c.accent, 1);
  return p;
}

function table(c: Palette): Pixels {
  const p = new Pixels(48, 32);
  legs(p, 5, 23, 38, c.woodDark);
  p.box(1, 7, 46, 20, c.woodDark, 2);
  p.box(2, 7, 44, 15, c.wood, 2);
  p.rect(4, 7, 40, 2, c.woodLight);
  p.rect(5, 20, 38, 1, c.woodShade);
  p.rect(9, 13, 9, 9, '#efe8d2');
  p.rect(9, 12, 9, 7, c.fabric);
  p.rect(10, 12, 1, 7, c.fabricLight);
  mug(p, 32, 13);
  return p;
}

function plant(c: Palette): Pixels {
  const p = new Pixels(32, 48);
  p.rect(12, 32, 10, 13, '#865841');
  p.rect(13, 34, 8, 12, c.accent);
  p.rect(12, 43, 10, 2, '#9f6448');
  p.rect(10, 31, 14, 4, '#c08a62');
  p.rect(12, 31, 10, 2, '#574e38');
  p.rect(16, 10, 2, 22, c.leafDark);
  const leaves = [
    [7, 19, 10, 6],
    [17, 14, 11, 7],
    [10, 6, 8, 11],
    [19, 4, 7, 9],
    [2, 10, 11, 6],
    [20, 24, 10, 6],
    [5, 27, 10, 5],
  ];
  for (const [x, y, w, h] of leaves) {
    p.box(x, y, w, h, c.leafDark, 2);
    p.box(x + 1, y, w - 2, h - 2, c.leaf, 2);
    p.rect(x + 2, y + 1, Math.max(2, w - 5), 2, c.leafLight);
  }
  return p;
}

function shelf(c: Palette): Pixels {
  const p = new Pixels(40, 64);
  legs(p, 2, 55, 36, c.woodDark);
  p.rect(1, 10, 38, 49, c.woodDark);
  p.rect(4, 12, 32, 43, c.woodShade);
  const bookColors = ['#5a7c77', '#d1b07b', '#b5745d', '#879b9c', '#e8d8ad'];
  for (const y of [15, 34]) {
    for (let i = 0; i < 7; i++) {
      const height = 11 + (i % 3);
      p.rect(5 + i * 4, y + 14 - height, 3, height, bookColors[i % 5]);
      p.rect(6 + i * 4, y + 17 - height, 1, 1, '#ead6ac');
    }
  }
  for (const y of [10, 30, 51]) {
    p.rect(1, y, 38, 4, c.wood);
    p.rect(2, y, 36, 1, c.woodLight);
  }
  p.rect(1, 12, 3, 44, c.wood);
  p.rect(36, 12, 3, 44, c.wood);
  p.rect(8, 5, 8, 6, c.accent);
  p.box(5, 0, 12, 7, c.leaf, 2);
  p.box(14, 5, 5, 10, c.leafDark, 1);
  p.rect(7, 1, 6, 2, c.leafLight);
  return p;
}

function counter(c: Palette): Pixels {
  const p = new Pixels(64, 48);
  p.rect(3, 23, 58, 23, c.fabricShade);
  for (const x of [5, 24, 43]) {
    p.rect(x, 25, 17, 18, c.fabric);
    p.rect(x + 1, 25, 15, 1, c.fabricLight);
    p.rect(x + 12, 29, 2, 5, '#dfbc78');
  }
  p.box(0, 16, 64, 9, c.woodDark);
  p.rect(1, 16, 62, 6, c.wood);
  p.rect(1, 16, 62, 1, c.woodLight);
  p.box(8, 2, 22, 18, '#41524d');
  p.rect(9, 3, 20, 5, '#8e9c90');
  p.rect(11, 4, 3, 2, '#bac6b2');
  p.rect(24, 4, 2, 2, '#cdb981');
  p.rect(12, 10, 14, 6, '#293c38');
  p.rect(18, 9, 2, 4, '#b9c1ac');
  p.rect(10, 19, 18, 2, '#9ca699');
  mug(p, 16, 15);
  mug(p, 38, 18);
  mug(p, 49, 18);
  return p;
}

function windowSprite(c: Palette): Pixels {
  const p = new Pixels(64, 40);
  p.rect(1, 1, 62, 35, c.trim);
  p.rect(3, 2, 58, 31, '#f9f1dd');
  p.rect(6, 5, 24, 25, '#b7d5d8');
  p.rect(34, 5, 24, 25, '#b7d5d8');
  for (const x of [6, 34]) {
    p.rect(x, 5, 24, 3, '#a1c4cd');
    for (let i = 0; i < 5; i++) p.rect(x + i * 3, 23 - i * 3, 4, 4, '#d9ece5');
    p.rect(x, 27, 24, 3, '#99bbaa');
  }
  p.rect(0, 34, 64, 4, c.trim);
  p.rect(1, 33, 62, 3, '#fcf4dd');
  p.rect(4, 38, 56, 1, c.woodShade);
  return p;
}

function floor(c: Palette): Pixels {
  const p = new Pixels(32, 32);
  p.rect(0, 0, 32, 32, c.floor);
  for (const y of [0, 8, 16, 24]) {
    p.rect(0, y, 32, 1, c.floorShade);
    p.rect(0, y + 1, 32, 1, c.floorLight);
    p.rect((y * 3 + 11) % 32, y, 1, 8, c.floorShade);
    p.rect((y + 4) % 20, y + 4, 9, 1, c.floorLight);
  }
  return p;
}

function carpet(c: Palette): Pixels {
  const p = new Pixels(16, 16);
  p.rect(0, 0, 16, 16, c.carpet);
  for (let y = 1; y < 16; y += 4) for (let x = y % 3; x < 16; x += 5) p.rect(x, y, 1, 1, c.carpetLight);
  return p;
}

function wall(c: Palette): Pixels {
  const p = new Pixels(16, 48);
  p.rect(0, 0, 16, 48, c.wall);
  p.rect(0, 0, 16, 3, c.trim);
  p.rect(0, 3, 16, 2, c.wallShade);
  p.rect(0, 41, 16, 2, c.wallShade);
  p.rect(0, 43, 16, 5, c.trim);
  p.rect(0, 44, 16, 1, c.woodLight);
  return p;
}

function door(c: Palette): Pixels {
  const p = new Pixels(32, 48);
  p.rect(0, 0, 32, 48, c.woodDark);
  p.rect(2, 1, 28, 47, c.woodLight);
  p.rect(4, 3, 24, 45, c.wood);
  p.rect(6, 6, 20, 23, c.woodShade);
  p.rect(7, 7, 18, 21, '#b7d5d8');
  p.rect(8, 8, 16, 2, '#d9ece5');
  p.rect(6, 35, 20, 10, c.woodShade);
  p.rect(7, 36, 18, 8, c.wood);
  p.rect(23, 31, 4, 2, '#f0d29b');
  return p;
}

function meetingTable(c: Palette): Pixels {
  const p = new Pixels(80, 48);
  p.rect(15, 30, 5, 16, c.woodDark);
  p.rect(60, 30, 5, 16, c.woodDark);
  p.box(0, 6, 80, 30, INK, 5);
  p.box(1, 6, 78, 27, c.woodShade, 5);
  p.box(2, 6, 76, 23, c.wood, 5);
  p.rect(8, 7, 64, 2, c.woodLight);
  p.rect(9, 17, 16, 1, c.woodLight);
  p.rect(49, 24, 17, 1, c.woodShade);
  p.box(26, 11, 26, 15, c.carpetShade, 2);
  p.rect(27, 11, 24, 13, c.carpet);
  p.box(33, 13, 12, 8, INK, 2);
  p.rect(36, 14, 6, 1, '#708687');
  p.rect(34, 22, 10, 1, c.carpetLight);
  mug(p, 10, 16);
  mug(p, 62, 13);
  p.box(54, 20, 10, 7, '#eee7ce');
  p.rect(56, 22, 6, 1, '#a0aca2');
  return p;
}

function whiteboard(c: Palette): Pixels {
  const p = new Pixels(64, 64);
  p.rect(12, 36, 3, 23, '#71817c');
  p.rect(49, 36, 3, 23, '#52635d');
  p.rect(7, 58, 15, 3, INK);
  p.rect(43, 58, 15, 3, INK);
  p.box(2, 1, 60, 40, INK, 2);
  p.rect(4, 3, 56, 35, '#aab6aa');
  p.rect(5, 4, 54, 32, '#f0f1e3');
  p.rect(6, 5, 52, 1, '#ffffff');
  p.rect(12, 11, 18, 2, '#62867e');
  p.rect(12, 17, 27, 1, '#9bac9c');
  p.rect(12, 22, 13, 1, '#9bac9c');
  p.rect(12, 27, 23, 1, '#9bac9c');
  p.rect(42, 11, 8, 7, c.accent);
  p.rect(44, 22, 8, 7, '#d9bc75');
  p.rect(7, 38, 50, 3, '#71817c');
  p.rect(13, 38, 7, 1, '#346658');
  p.rect(25, 38, 7, 1, '#9b5e54');
  return p;
}

function divider(c: Palette): Pixels {
  const p = new Pixels(48, 40);
  p.rect(4, 34, 10, 5, c.woodDark);
  p.rect(34, 34, 10, 5, c.woodDark);
  p.box(1, 3, 46, 32, INK, 2);
  p.rect(3, 4, 42, 28, c.wood);
  p.rect(5, 6, 38, 24, c.fabricShade);
  p.rect(6, 6, 36, 21, c.fabric);
  for (let y = 8; y < 26; y += 4) for (let x = 8; x < 41; x += 5) p.rect(x, y, 1, 1, c.fabricLight);
  p.rect(3, 4, 42, 1, c.woodLight);
  p.rect(4, 31, 40, 2, c.woodShade);
  return p;
}

function floorLamp(c: Palette): Pixels {
  const p = new Pixels(24, 64);
  p.box(3, 56, 18, 6, INK, 2);
  p.rect(5, 56, 14, 2, '#69786e');
  p.rect(11, 21, 3, 36, INK);
  p.rect(11, 23, 1, 31, c.woodLight);
  p.box(2, 6, 21, 19, c.woodDark, 4);
  p.box(3, 6, 19, 17, c.wallShade, 4);
  p.rect(6, 5, 13, 2, '#f4ecd2');
  p.rect(5, 9, 15, 11, c.wall);
  p.rect(8, 8, 1, 13, '#fff7dc');
  p.rect(4, 21, 17, 2, c.woodLight);
  return p;
}

export const assetDefinitions = {
  ...compactOfficeAssets,
  desk: { name: 'Schreibtisch', draw: desk, collisionBaseRows: 2 },
  desk_east: {
    name: 'Schreibtisch · Osten',
    draw: deskEast,
    collisionBaseRows: 2,
  },
  desk_north: {
    name: 'Schreibtisch · Norden',
    draw: deskNorth,
    collisionBaseRows: 2,
  },
  desk_west: {
    name: 'Schreibtisch · Westen',
    draw: deskWest,
    collisionBaseRows: 2,
  },
  chair: { name: 'Bürostuhl', draw: chair, collisionBaseRows: 1 },
  chair_east: {
    name: 'Bürostuhl · Osten',
    draw: chairEast,
    collisionBaseRows: 1,
  },
  chair_north: {
    name: 'Bürostuhl · Norden',
    draw: chairNorth,
    collisionBaseRows: 1,
  },
  chair_west: {
    name: 'Bürostuhl · Westen',
    draw: chairWest,
    collisionBaseRows: 1,
  },
  sofa: { name: 'Zweisitzer', draw: sofa, collisionBaseRows: 2 },
  sofa_east: {
    name: 'Zweisitzer · Osten',
    draw: sofaEast,
    collisionBaseRows: 2,
  },
  sofa_north: {
    name: 'Zweisitzer · Norden',
    draw: sofaNorth,
    collisionBaseRows: 2,
  },
  sofa_west: {
    name: 'Zweisitzer · Westen',
    draw: sofaWest,
    collisionBaseRows: 2,
  },
  table: { name: 'Beistelltisch', draw: table, collisionBaseRows: 1 },
  plant: { name: 'Zimmerpflanze', draw: plant, collisionBaseRows: 1 },
  shelf: { name: 'Bücherregal', draw: shelf, collisionBaseRows: 1 },
  counter: { name: 'Kaffeebar', draw: counter, collisionBaseRows: 1 },
  meeting_table: {
    name: 'Besprechungstisch',
    draw: meetingTable,
    collisionBaseRows: 2,
  },
  whiteboard: { name: 'Whiteboard', draw: whiteboard, collisionBaseRows: 1 },
  divider: { name: 'Akustikstellwand', draw: divider, collisionBaseRows: 1 },
  floor_lamp: { name: 'Stehlampe', draw: floorLamp, collisionBaseRows: 1 },
  window: { name: 'Fenster', draw: windowSprite, collisionBaseRows: 0 },
  floor: { name: 'Eichenboden', draw: floor, collisionBaseRows: 0 },
  carpet: { name: 'Teppich', draw: carpet, collisionBaseRows: 0 },
  wall: { name: 'Wand', draw: wall, collisionBaseRows: 1 },
  door: { name: 'Tür', draw: door, collisionBaseRows: 1 },
  wall_set: { name: 'Wandatlas', draw: wallSet, collisionBaseRows: 0 },
  door_open: { name: 'Türöffnung', draw: doorOpen, collisionBaseRows: 0 },
  planter: { name: 'Pflanzschale', draw: planter, collisionBaseRows: 1 },
  bench: { name: 'Bank', draw: bench, collisionBaseRows: 1 },
  plant_small: {
    name: 'Kleine Pflanze',
    draw: plantSmall,
    collisionBaseRows: 1,
  },
} as const;

export type AssetId = keyof typeof assetDefinitions;
export type AssetLibrary = Record<AssetId, Pixels>;

/** Richtungsfamilien für den begehbaren Raum; jede Ansicht bleibt separat editierbar. */
export const directionalAssets = {
  compact_desk: {
    0: 'compact_desk',
    90: 'compact_desk_east',
    180: 'compact_desk_north',
    270: 'compact_desk_west',
  },
  compact_chair: {
    0: 'compact_chair',
    90: 'compact_chair_east',
    180: 'compact_chair_north',
    270: 'compact_chair_west',
  },
  compact_sofa: {
    0: 'compact_sofa',
    90: 'compact_sofa_east',
    180: 'compact_sofa_north',
    270: 'compact_sofa_west',
  },
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
} as const;

/** Kollisionsbasis in Kachelzeilen; Vorschau wie im vorhandenen Serverraster. */
export function assetCollisionFootprint(id: AssetId, pixels: Pixels) {
  const rows = assetDefinitions[id].collisionBaseRows;
  if (!rows) return null;
  const heightInTiles = Math.ceil(pixels.height / TILE_SIZE);
  const baseRows = Math.min(rows, heightInTiles);
  return {
    x: 0,
    y: (heightInTiles - baseRows) * TILE_SIZE,
    w: Math.ceil(pixels.width / TILE_SIZE) * TILE_SIZE,
    h: baseRows * TILE_SIZE,
  };
}

export function buildAssets(theme: ThemeId): AssetLibrary {
  return Object.fromEntries(
    Object.entries(assetDefinitions).map(([id, spec]) => [id, spec.draw(themes[theme])]),
  ) as AssetLibrary;
}
