import { Pixels } from './pixels.ts';
import type { Palette } from './assets.ts';

const ink = '#35433f',
  metal = '#586564',
  paper = '#eee9d5';
type Facing = 'south' | 'north' | 'east' | 'west';

/** Neue Möbel werden im kleinen Raster gezeichnet, mit Standfläche auf vollen Kacheln. */
function desk(c: Palette, facing: Facing): Pixels {
  const side = facing === 'east' || facing === 'west';
  const p = new Pixels(side ? 32 : 48, side ? 48 : 32);
  if (side) {
    const east = facing === 'east',
      mx = east ? 19 : 3;
    p.rect(5, 27, 3, 21, c.woodDark);
    p.rect(25, 27, 3, 21, c.woodDark);
    p.box(2, 16, 28, 14, c.woodDark);
    p.rect(3, 17, 26, 9, c.wood);
    p.rect(4, 17, 24, 1, c.woodLight);
    p.rect(3, 26, 26, 13, c.woodShade);
    p.rect(4, 27, 24, 2, c.wood);
    p.rect(5, 30, 3, 8, c.woodLight);
    p.rect(25, 30, 3, 8, c.woodDark);
    p.box(mx, 4, 10, 14, ink);
    p.rect(mx + 1, 5, 7, 10, '#253b42');
    p.rect(mx + 2, 6, 5, 1, '#9bb3b0');
    p.rect(mx + 2, 9, 4, 1, '#71978f');
    p.rect(mx + 3, 17, 3, 3, ink);
    p.rect(mx, 20, 10, 1, metal);
    p.rect(east ? 8 : 17, 22, 7, 3, paper);
    p.rect(east ? 7 : 23, 18, 3, 3, paper);
  } else {
    p.rect(5, 20, 4, 12, c.woodDark);
    p.rect(39, 20, 4, 12, c.woodDark);
    p.rect(35, 21, 9, 7, c.woodShade);
    p.rect(36, 22, 7, 2, c.wood);
    p.rect(39, 23, 2, 1, c.woodLight);
    p.box(1, 12, 46, 12, c.woodDark);
    p.rect(2, 12, 44, 8, c.wood);
    p.rect(3, 12, 42, 1, c.woodLight);
    p.rect(2, 20, 44, 3, c.woodShade);
    p.box(16, 0, 21, 13, ink);
    p.rect(18, 2, 17, 9, facing === 'north' ? '#405452' : '#253b42');
    p.rect(19, 3, 15, 1, '#526d70');
    if (facing === 'north') {
      p.rect(20, 5, 13, 4, '#344a48');
      p.rect(25, 5, 3, 6, '#607774');
    } else {
      p.rect(20, 5, 8, 1, '#9bb3b0');
      p.rect(20, 7, 12, 1, '#71978f');
    }
    p.rect(25, 12, 3, 2, ink);
    p.rect(22, 14, 10, 1, metal);
    if (facing === 'south') {
      p.box(14, 17, 16, 3, paper);
      for (let x = 16; x < 28; x += 3) p.rect(x, 18, 1, 1, '#b9bba9');
    }
    p.rect(39, 15, 4, 4, '#fcf4dc');
    p.rect(40, 15, 2, 1, '#73604e');
    p.rect(43, 16, 1, 2, '#fcf4dc');
    p.rect(5, 17, 7, 1, c.woodLight);
  }
  return p;
}

function chair(c: Palette, facing: Facing): Pixels {
  // Acht freie Pixel oben: das sichtbare 16×24-Bild endet exakt an der Kachelbasis.
  const p = new Pixels(16, 32),
    y = 8;
  p.rect(7, y + 16, 2, 6, metal);
  p.rect(2, y + 21, 12, 2, ink);
  p.rect(7, y + 21, 2, 3, ink);
  p.box(2, y + 10, 12, 7, c.fabricShade);
  p.rect(3, y + 11, 10, 4, c.fabric);
  p.rect(3, y + 11, 10, 1, c.fabricLight);
  const side = facing === 'east' || facing === 'west';
  const x = side ? (facing === 'east' ? 1 : 10) : 2,
    w = side ? 5 : 12;
  p.box(x, y, w, 11, ink, side ? 1 : 2);
  p.rect(x + 1, y + 1, w - 2, 8, c.fabricShade);
  p.rect(x + 1, y + 2, w - 2, facing === 'north' ? 3 : 6, c.fabric);
  p.rect(x + 1, y + 2, w - 2, 1, c.fabricLight);
  if (side) {
    p.rect(x + (facing === 'east' ? 4 : -4), y + 9, 4, 2, ink);
  }
  if (facing === 'north') p.rect(7, y + 5, 2, 3, c.fabricShade);
  return p;
}

function sofa(c: Palette, facing: Facing): Pixels {
  const side = facing === 'east' || facing === 'west';
  const p = new Pixels(side ? 32 : 48, 32),
    w = p.width;
  p.rect(5, 26, 3, 6, c.woodDark);
  p.rect(w - 8, 26, 3, 6, c.woodDark);
  p.box(1, 12, w - 2, 15, c.fabricShade, 2);
  p.rect(3, 13, w - 6, 9, c.fabric);
  p.rect(4, 13, w - 8, 2, c.fabricLight);
  if (side) {
    const x = facing === 'east' ? 1 : 23;
    p.box(x, 3, 8, 22, c.fabricShade, 2);
    p.rect(x + 1, 4, 6, 17, c.fabric);
    p.rect(x + 2, 4, 4, 1, c.fabricLight);
    const arm = facing === 'east' ? 24 : 1;
    p.box(arm, 11, 7, 14, c.fabricShade);
    p.rect(arm + 1, 12, 5, 2, c.fabricLight);
  } else {
    p.box(2, 2, 44, facing === 'north' ? 23 : 12, c.fabricShade, 2);
    p.rect(4, 3, 40, facing === 'north' ? 17 : 8, c.fabric);
    p.rect(5, 3, 38, 2, c.fabricLight);
    for (const x of [0, 42]) {
      p.box(x, 11, 6, 15, c.fabricShade);
      p.rect(x + 1, 12, 4, 2, c.fabricLight);
    }
    if (facing === 'south') {
      p.rect(23, 14, 1, 8, c.fabricShade);
      p.box(9, 13, 8, 6, paper);
    } else p.rect(10, 21, 28, 1, c.fabricLight);
  }
  return p;
}

function table(c: Palette, meeting: boolean): Pixels {
  const p = new Pixels(meeting ? 64 : 32, 32),
    w = p.width;
  p.rect(5, 21, 3, 11, c.woodDark);
  p.rect(w - 8, 21, 3, 11, c.woodDark);
  p.box(0, 9, w, 16, c.woodDark, 3);
  p.box(1, 9, w - 2, 12, c.wood, 3);
  p.rect(5, 10, w - 10, 1, c.woodLight);
  p.rect(9, 15, 7, 1, c.woodLight);
  if (meeting) {
    p.box(25, 12, 14, 8, ink);
    p.rect(27, 13, 10, 4, metal);
    p.rect(13, 15, 3, 3, paper);
    p.rect(46, 13, 7, 5, paper);
  } else {
    p.box(17, 12, 8, 5, c.fabricShade);
    p.rect(18, 12, 6, 1, paper);
  }
  return p;
}

function cabinet(c: Palette, bookshelf: boolean): Pixels {
  const p = new Pixels(32, 48);
  p.rect(3, 43, 3, 5, c.woodDark);
  p.rect(26, 43, 3, 5, c.woodDark);
  p.box(1, 6, 30, 38, c.woodDark);
  p.rect(2, 6, 28, 2, c.woodLight);
  p.rect(3, 9, 26, 33, c.wood);
  if (bookshelf) {
    for (const y of [11, 23, 35]) {
      p.rect(4, y, 24, 9, c.woodShade);
      for (let x = 5; x < 26; x += 5) {
        p.rect(x, y + 1, 3, 7, x % 2 ? c.fabric : c.accent);
        p.rect(x, y + 2, 3, 1, paper);
      }
      p.rect(3, y + 9, 26, 2, c.woodLight);
    }
  } else {
    p.rect(15, 9, 1, 33, c.woodShade);
    p.rect(12, 22, 2, 5, metal);
    p.rect(18, 22, 2, 5, metal);
    p.rect(5, 11, 8, 1, c.woodLight);
    p.rect(18, 11, 8, 1, c.woodLight);
  }
  return p;
}

function counter(c: Palette): Pixels {
  const p = new Pixels(48, 32);
  p.rect(3, 18, 42, 14, c.woodDark);
  p.rect(4, 19, 40, 11, c.wood);
  p.rect(23, 20, 1, 9, c.woodShade);
  p.rect(18, 23, 3, 1, metal);
  p.rect(27, 23, 3, 1, metal);
  p.rect(1, 15, 46, 5, c.woodShade);
  p.rect(1, 15, 46, 1, c.woodLight);
  p.box(7, 2, 16, 14, ink);
  p.rect(8, 3, 14, 3, metal);
  p.rect(10, 8, 10, 6, '#253b42');
  p.rect(14, 7, 2, 3, paper);
  p.rect(13, 11, 4, 4, paper);
  p.rect(32, 12, 4, 4, paper);
  p.rect(38, 12, 4, 4, paper);
  return p;
}

function plant(c: Palette): Pixels {
  const p = new Pixels(16, 32);
  p.rect(7, 8, 2, 17, c.leafDark);
  p.box(0, 8, 10, 8, c.leafDark, 2);
  p.box(1, 8, 8, 5, c.leaf, 2);
  p.rect(3, 9, 4, 1, c.leafLight);
  p.box(7, 2, 9, 9, c.leafDark, 2);
  p.box(8, 3, 7, 5, c.leaf, 2);
  p.rect(10, 4, 3, 1, c.leafLight);
  p.rect(4, 22, 8, 9, c.woodDark);
  p.rect(5, 23, 6, 7, c.accent);
  p.rect(4, 22, 8, 2, c.woodLight);
  return p;
}

function board(c: Palette, pins: boolean): Pixels {
  const p = new Pixels(48, 48);
  p.rect(6, 30, 2, 16, metal);
  p.rect(39, 30, 2, 16, metal);
  p.rect(3, 45, 10, 3, ink);
  p.rect(35, 45, 10, 3, ink);
  p.box(1, 5, 46, 28, ink);
  p.rect(3, 7, 42, 23, pins ? c.wood : paper);
  p.rect(3, 7, 42, 1, pins ? c.woodLight : '#fcf4dc');
  if (pins) {
    for (const [x, y, color] of [
      [8, 11, paper],
      [25, 15, '#d6b368'],
      [12, 22, c.carpetLight],
    ] as const) {
      p.rect(x, y, 10, 6, color);
      p.rect(x + 4, y, 1, 1, c.accent);
    }
  } else {
    p.rect(8, 12, 14, 1, c.fabric);
    p.rect(8, 17, 21, 1, c.fabricLight);
    p.rect(8, 22, 17, 1, c.fabricLight);
    p.rect(33, 12, 6, 5, c.accent);
  }
  p.rect(2, 31, 44, 2, metal);
  return p;
}

function lamp(c: Palette): Pixels {
  const p = new Pixels(16, 32);
  p.box(2, 27, 12, 5, ink);
  p.rect(3, 28, 10, 1, metal);
  p.rect(7, 11, 2, 17, ink);
  p.rect(7, 12, 1, 15, c.woodLight);
  p.box(1, 1, 14, 12, c.woodDark, 2);
  p.box(2, 2, 12, 9, c.wall, 2);
  p.rect(4, 2, 8, 1, paper);
  p.rect(3, 11, 10, 1, c.woodLight);
  return p;
}

function drawer(c: Palette, printer = false): Pixels {
  const p = new Pixels(16, 32),
    y = printer ? 14 : 12;
  p.rect(2, 28, 3, 4, ink);
  p.rect(11, 28, 3, 4, ink);
  p.box(0, y, 16, 17, c.woodDark);
  p.rect(1, y, 14, 2, c.woodLight);
  for (const dy of [3, 9]) {
    p.rect(2, y + dy, 12, 5, c.wood);
    p.rect(6, y + dy + 1, 4, 1, metal);
  }
  if (printer) {
    p.box(0, 4, 16, 11, ink);
    p.rect(1, 5, 14, 7, metal);
    p.rect(3, 9, 10, 4, ink);
    p.rect(4, 10, 8, 4, paper);
    p.rect(4, 0, 8, 6, paper);
    p.rect(6, 2, 4, 1, c.carpetShade);
    p.rect(12, 6, 2, 1, c.leafLight);
  }
  return p;
}

function armchair(c: Palette): Pixels {
  const p = new Pixels(32, 32);
  p.rect(5, 26, 3, 6, c.woodDark);
  p.rect(24, 26, 3, 6, c.woodDark);
  p.box(3, 4, 26, 18, c.fabricShade, 3);
  p.box(5, 5, 22, 13, c.fabric, 2);
  p.rect(7, 6, 18, 1, c.fabricLight);
  p.box(3, 17, 26, 11, c.fabricShade, 2);
  p.rect(6, 18, 20, 6, c.fabricLight);
  p.rect(7, 19, 18, 1, c.fabric);
  for (const x of [1, 25]) {
    p.box(x, 14, 6, 13, c.fabricShade);
    p.rect(x + 1, 15, 4, 2, c.fabricLight);
  }
  return p;
}

function roundTable(c: Palette): Pixels {
  const p = new Pixels(32, 32);
  p.rect(14, 20, 4, 10, c.woodDark);
  p.rect(8, 29, 16, 3, c.woodDark);
  const insets = [8, 5, 3, 2, 1, 1, 0, 0, 1, 1, 2, 3, 5, 8];
  insets.forEach((inset, row) => p.rect(1 + inset, 9 + row, 30 - inset * 2, 1, c.woodDark));
  insets.forEach((inset, row) => p.rect(1 + inset, 6 + row, 30 - inset * 2, 1, c.wood));
  p.rect(9, 7, 14, 1, c.woodLight);
  p.rect(10, 12, 4, 4, paper);
  p.rect(21, 13, 3, 3, paper);
  return p;
}

function coatStand(c: Palette): Pixels {
  const p = new Pixels(16, 48);
  p.rect(7, 7, 2, 39, c.woodDark);
  p.rect(7, 7, 1, 34, c.woodLight);
  p.rect(2, 44, 12, 3, ink);
  p.rect(3, 12, 10, 2, c.woodDark);
  p.rect(2, 9, 2, 5, c.woodLight);
  p.rect(12, 9, 2, 5, c.woodShade);
  p.box(1, 16, 8, 20, c.fabricShade);
  p.rect(2, 17, 6, 17, c.fabric);
  p.rect(3, 18, 2, 15, c.fabricLight);
  p.rect(9, 18, 5, 2, c.accent);
  p.rect(11, 18, 2, 19, c.accent);
  return p;
}

function waterCooler(c: Palette): Pixels {
  const p = new Pixels(16, 32);
  p.box(1, 13, 14, 19, ink);
  p.rect(2, 14, 12, 16, paper);
  p.rect(4, 18, 8, 8, c.carpetShade);
  p.rect(5, 19, 2, 2, c.accent);
  p.rect(9, 19, 2, 2, c.carpet);
  p.rect(6, 23, 4, 3, paper);
  p.box(3, 1, 10, 13, c.carpetShade, 2);
  p.rect(4, 3, 8, 9, c.carpet);
  p.rect(5, 3, 2, 7, c.carpetLight);
  p.rect(5, 12, 6, 2, metal);
  return p;
}

function bench(c: Palette): Pixels {
  const p = new Pixels(48, 32);
  p.rect(5, 23, 3, 9, c.woodDark);
  p.rect(40, 23, 3, 9, c.woodDark);
  p.box(0, 14, 48, 11, c.woodDark);
  p.rect(1, 15, 46, 6, c.wood);
  p.rect(2, 15, 44, 1, c.woodLight);
  p.rect(2, 18, 44, 1, c.woodShade);
  return p;
}

function divider(c: Palette): Pixels {
  const p = new Pixels(32, 32);
  p.rect(2, 28, 7, 4, c.woodDark);
  p.rect(23, 28, 7, 4, c.woodDark);
  p.box(1, 3, 30, 26, c.woodDark);
  p.rect(2, 4, 28, 22, c.fabricShade);
  p.rect(3, 4, 26, 20, c.fabric);
  p.rect(3, 4, 26, 1, c.fabricLight);
  for (let y = 8; y < 23; y += 4) for (let x = 5; x < 29; x += 5) p.rect(x, y, 1, 1, c.fabricLight);
  return p;
}

const definition = (name: string, draw: (c: Palette) => Pixels, collisionBaseRows = 1) => ({
  name,
  draw,
  collisionBaseRows,
});
export const compactOfficeAssets = {
  compact_desk: definition('Kompakt · Schreibtisch', (c) => desk(c, 'south')),
  compact_desk_east: definition('Kompakt · Schreibtisch Osten', (c) => desk(c, 'east')),
  compact_desk_north: definition('Kompakt · Schreibtisch Norden', (c) => desk(c, 'north')),
  compact_desk_west: definition('Kompakt · Schreibtisch Westen', (c) => desk(c, 'west')),
  compact_chair: definition('Kompakt · Stuhl', (c) => chair(c, 'south')),
  compact_chair_east: definition('Kompakt · Stuhl Osten', (c) => chair(c, 'east')),
  compact_chair_north: definition('Kompakt · Stuhl Norden', (c) => chair(c, 'north')),
  compact_chair_west: definition('Kompakt · Stuhl Westen', (c) => chair(c, 'west')),
  compact_sofa: definition('Kompakt · Sofa', (c) => sofa(c, 'south')),
  compact_sofa_east: definition('Kompakt · Sofa Osten', (c) => sofa(c, 'east')),
  compact_sofa_north: definition('Kompakt · Sofa Norden', (c) => sofa(c, 'north')),
  compact_sofa_west: definition('Kompakt · Sofa Westen', (c) => sofa(c, 'west')),
  compact_table: definition('Kompakt · Beistelltisch', (c) => table(c, false)),
  compact_meeting_table: definition('Kompakt · Besprechungstisch', (c) => table(c, true)),
  compact_shelf: definition('Kompakt · Bücherregal', (c) => cabinet(c, true)),
  compact_counter: definition('Kompakt · Kaffeebar', counter),
  compact_plant: definition('Kompakt · Zimmerpflanze', plant),
  compact_whiteboard: definition('Kompakt · Whiteboard', (c) => board(c, false)),
  compact_floor_lamp: definition('Kompakt · Stehlampe', lamp),
  compact_bench: definition('Kompakt · Bank', bench),
  compact_divider: definition('Kompakt · Stellwand', divider),
  drawer: definition('Rollcontainer', (c) => drawer(c)),
  cabinet: definition('Aktenschrank', (c) => cabinet(c, false)),
  armchair: definition('Loungesessel', armchair),
  round_table: definition('Runder Gesprächstisch', roundTable),
  printer: definition('Druckerstation', (c) => drawer(c, true)),
  coat_stand: definition('Garderobe', coatStand),
  water_cooler: definition('Wasserspender', waterCooler),
  pinboard: definition('Pinnwand', (c) => board(c, true)),
};
