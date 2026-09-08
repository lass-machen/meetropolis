import { Pixels } from './pixels.ts';
import type { Palette } from './assets.ts';

const INK = '#35433f';

/** Eigenständige Seitenansicht des Schreibtischs, Blickrichtung Osten. */
export function deskEast(c: Palette): Pixels {
  const p = new Pixels(48, 64);
  p.rect(4, 52, 40, 5, c.woodDark);
  p.rect(8, 54, 4, 10, c.woodDark);
  p.rect(36, 54, 4, 10, c.woodDark);
  p.box(5, 23, 39, 17, INK, 2);
  p.rect(7, 23, 35, 12, c.wood);
  p.rect(8, 24, 33, 2, c.woodLight);
  p.rect(7, 35, 35, 4, c.woodShade);
  p.rect(12, 31, 15, 2, c.woodLight);
  p.rect(7, 39, 35, 13, c.woodShade);
  p.rect(9, 40, 31, 2, c.wood);
  p.rect(8, 49, 33, 3, c.woodDark);
  p.rect(9, 42, 4, 9, c.woodLight);
  p.rect(36, 42, 4, 9, c.woodDark);
  p.box(22, 5, 20, 19, INK, 2);
  p.rect(24, 7, 16, 14, '#253b42');
  p.rect(25, 8, 14, 1, '#526d70');
  p.rect(27, 11, 8, 1, '#9bb3b0');
  p.rect(27, 14, 11, 1, '#71978f');
  p.rect(27, 18, 7, 1, '#58797c');
  p.rect(28, 24, 4, 3, INK);
  p.rect(16, 27, 13, 2, '#516362');
  p.box(13, 30, 9, 5, '#eee9d5');
  for (let x = 15; x < 21; x += 3) p.rect(x, 31, 1, 2, '#b9bba9');
  p.rect(38, 28, 4, 5, '#dfdfcc');
  p.rect(37, 25, 5, 4, '#fcf4dc');
  p.rect(42, 26, 2, 2, '#fcf4dc');
  p.rect(38, 25, 3, 1, '#73604e');
  return p;
}

/** Eigenständige Rückansicht des Schreibtischs, Blickrichtung Norden. */
export function deskNorth(c: Palette): Pixels {
  const p = new Pixels(64, 48);
  p.rect(6, 30, 4, 16, c.woodDark);
  p.rect(54, 30, 4, 16, c.woodDark);
  p.box(0, 14, 64, 17, INK);
  p.rect(2, 15, 60, 13, c.woodShade);
  p.rect(3, 16, 58, 2, c.woodLight);
  p.rect(2, 27, 60, 3, c.woodDark);
  p.rect(8, 21, 17, 2, c.wood);
  p.rect(39, 20, 16, 2, c.wood);
  p.box(15, 1, 34, 16, INK, 2);
  p.rect(17, 3, 30, 11, '#405452');
  p.rect(19, 4, 26, 2, '#607774');
  p.rect(20, 7, 24, 7, '#344a48');
  p.rect(30, 7, 5, 7, '#506965');
  p.rect(32, 8, 1, 5, '#7d9389');
  p.rect(23, 14, 18, 1, '#293f3d');
  p.rect(26, 17, 12, 3, INK);
  p.rect(23, 21, 18, 2, '#516362');
  p.rect(47, 21, 6, 4, '#eee9d5');
  p.rect(49, 22, 3, 1, '#b9bba9');
  return p;
}

/** Eigenständige Seitenansicht des Schreibtischs, Blickrichtung Westen. */
export function deskWest(c: Palette): Pixels {
  const p = new Pixels(48, 64);
  p.rect(4, 52, 40, 5, c.woodDark);
  p.rect(8, 54, 4, 10, c.woodDark);
  p.rect(36, 54, 4, 10, c.woodDark);
  p.box(4, 23, 39, 17, INK, 2);
  p.rect(6, 23, 35, 12, c.wood);
  p.rect(7, 24, 33, 2, c.woodLight);
  p.rect(6, 35, 35, 4, c.woodShade);
  p.rect(21, 31, 15, 2, c.woodLight);
  p.rect(6, 39, 35, 13, c.woodShade);
  p.rect(8, 40, 31, 2, c.wood);
  p.rect(7, 49, 33, 3, c.woodDark);
  p.rect(9, 42, 4, 9, c.woodDark);
  p.rect(36, 42, 4, 9, c.woodLight);
  p.box(6, 5, 20, 19, INK, 2);
  p.rect(8, 7, 16, 14, '#253b42');
  p.rect(9, 8, 14, 1, '#526d70');
  p.rect(11, 11, 8, 1, '#9bb3b0');
  p.rect(11, 14, 11, 1, '#71978f');
  p.rect(11, 18, 7, 1, '#58797c');
  p.rect(16, 24, 4, 3, INK);
  p.rect(19, 27, 13, 2, '#516362');
  p.box(26, 30, 9, 5, '#eee9d5');
  for (let x = 28; x < 34; x += 3) p.rect(x, 31, 1, 2, '#b9bba9');
  p.rect(6, 28, 4, 5, '#dfdfcc');
  p.rect(2, 25, 5, 4, '#fcf4dc');
  p.rect(0, 26, 2, 2, '#fcf4dc');
  p.rect(2, 25, 3, 1, '#73604e');
  return p;
}

/** Rechte Seitenansicht des Stuhls mit sichtbarer Rückenstärke. */
export function chairEast(c: Palette): Pixels {
  const p = new Pixels(32, 40);
  p.rect(14, 29, 4, 7, '#586564');
  p.rect(5, 35, 23, 2, INK);
  p.rect(4, 36, 5, 2, INK);
  p.rect(23, 36, 5, 2, INK);
  p.rect(14, 35, 3, 5, INK);
  p.box(8, 20, 19, 11, c.fabricShade, 2);
  p.rect(10, 21, 14, 6, c.fabric);
  p.rect(10, 21, 11, 2, c.fabricLight);
  p.rect(23, 23, 4, 7, c.fabricShade);
  p.box(4, 4, 10, 19, INK, 2);
  p.box(6, 5, 7, 16, c.fabricShade, 2);
  p.rect(7, 7, 5, 11, c.fabric);
  p.rect(8, 7, 4, 2, c.fabricLight);
  p.rect(11, 18, 7, 3, INK);
  p.rect(12, 18, 7, 1, c.fabricLight);
  return p;
}

/** Rückansicht des Stuhls mit klarer Lehnenkante. */
export function chairNorth(c: Palette): Pixels {
  const p = new Pixels(24, 32);
  p.rect(11, 23, 3, 6, '#586564');
  p.rect(4, 28, 17, 2, INK);
  p.rect(3, 29, 4, 2, INK);
  p.rect(18, 29, 4, 2, INK);
  p.rect(11, 28, 3, 4, INK);
  p.box(3, 15, 18, 10, c.fabricShade, 2);
  p.rect(5, 16, 14, 7, c.fabric);
  p.rect(5, 16, 14, 2, c.fabricLight);
  p.rect(4, 23, 16, 2, c.fabricShade);
  p.box(2, 1, 20, 18, INK, 3);
  p.box(4, 3, 16, 14, c.fabricShade, 2);
  p.rect(6, 4, 12, 3, c.fabric);
  p.rect(8, 7, 8, 1, c.fabricLight);
  return p;
}

/** Eigenständige linke Seitenansicht des Stuhls. */
export function chairWest(c: Palette): Pixels {
  const p = new Pixels(32, 40);
  p.rect(14, 29, 4, 7, '#586564');
  p.rect(4, 35, 23, 2, INK);
  p.rect(4, 36, 5, 2, INK);
  p.rect(23, 36, 5, 2, INK);
  p.rect(14, 35, 3, 5, INK);
  p.box(5, 20, 19, 11, c.fabricShade, 2);
  p.rect(8, 21, 14, 6, c.fabric);
  p.rect(9, 21, 11, 2, c.fabricLight);
  p.rect(5, 23, 4, 7, c.fabricShade);
  p.box(18, 4, 10, 19, INK, 2);
  p.box(19, 5, 7, 16, c.fabricShade, 2);
  p.rect(20, 7, 5, 11, c.fabric);
  p.rect(20, 7, 4, 2, c.fabricLight);
  p.rect(13, 18, 7, 3, INK);
  p.rect(13, 18, 7, 1, c.fabricLight);
  return p;
}

/** Rechte Seitenansicht des Sofas mit unterschiedlich tiefen Armlehnen. */
export function sofaEast(c: Palette): Pixels {
  const p = new Pixels(48, 48);
  p.rect(5, 39, 38, 4, c.woodDark);
  p.rect(9, 41, 4, 7, c.woodDark);
  p.rect(35, 41, 4, 7, c.woodDark);
  p.box(3, 5, 15, 33, c.fabricShade, 3);
  p.rect(6, 7, 9, 27, c.fabric);
  p.rect(8, 7, 6, 2, c.fabricLight);
  p.rect(11, 29, 4, 6, c.fabricShade);
  p.box(12, 24, 29, 14, c.fabricShade, 2);
  p.rect(14, 25, 24, 8, c.fabricLight);
  p.rect(15, 25, 20, 2, c.fabric);
  p.rect(35, 29, 6, 7, c.fabric);
  p.box(35, 17, 10, 20, c.fabricShade, 2);
  p.rect(37, 18, 6, 3, c.fabricLight);
  p.rect(14, 31, 18, 2, c.fabricShade);
  p.box(19, 25, 10, 8, '#e9daba', 2);
  p.rect(21, 25, 6, 2, '#fcf0d1');
  p.rect(20, 31, 7, 2, '#cabb9c');
  return p;
}

/** Rückansicht des Sofas mit betonter Rückenlehne. */
export function sofaNorth(c: Palette): Pixels {
  const p = new Pixels(64, 40);
  p.rect(7, 31, 50, 4, c.woodDark);
  p.rect(11, 33, 4, 7, c.woodDark);
  p.rect(49, 33, 4, 7, c.woodDark);
  p.box(3, 2, 58, 28, c.fabricShade, 3);
  p.rect(6, 4, 52, 18, c.fabric);
  p.rect(8, 4, 48, 2, c.fabricLight);
  p.rect(6, 22, 52, 6, c.fabricShade);
  p.rect(9, 28, 46, 3, c.fabric);
  p.box(0, 15, 8, 18, c.fabricShade, 2);
  p.rect(1, 16, 6, 3, c.fabricLight);
  p.box(56, 15, 8, 18, c.fabricShade, 2);
  p.rect(57, 16, 6, 3, c.fabricLight);
  p.rect(20, 19, 24, 2, c.fabricLight);
  p.rect(29, 24, 8, 2, c.fabricShade);
  return p;
}

/** Linke Seitenansicht des Sofas, als eigene Zeichnung statt einer Spiegelung. */
export function sofaWest(c: Palette): Pixels {
  const p = new Pixels(48, 48);
  p.rect(5, 39, 38, 4, c.woodDark);
  p.rect(9, 41, 4, 7, c.woodDark);
  p.rect(35, 41, 4, 7, c.woodDark);
  p.box(30, 5, 15, 33, c.fabricShade, 3);
  p.rect(33, 7, 9, 27, c.fabric);
  p.rect(35, 7, 6, 2, c.fabricLight);
  p.rect(33, 29, 4, 6, c.fabricShade);
  p.box(7, 24, 29, 14, c.fabricShade, 2);
  p.rect(10, 25, 24, 8, c.fabricLight);
  p.rect(13, 25, 20, 2, c.fabric);
  p.rect(7, 29, 6, 7, c.fabric);
  p.box(3, 17, 10, 20, c.fabricShade, 2);
  p.rect(5, 18, 6, 3, c.fabricLight);
  p.rect(13, 31, 18, 2, c.fabricShade);
  p.box(19, 25, 10, 8, '#e9daba', 2);
  p.rect(21, 25, 6, 2, '#fcf0d1');
  p.rect(20, 31, 7, 2, '#cabb9c');
  return p;
}

/**
 * Wandatlas mit vier Spalten und vier Zeilen. Der Index entspricht
 * `row = mask >> 2`, `column = mask & 3`; N=1, E=2, S=4, W=8.
 */
export function wallSet(c: Palette): Pixels {
  const p = new Pixels(64, 192);
  for (let mask = 0; mask < 16; mask++) {
    const x = (mask & 3) * 16;
    const y = (mask >> 2) * 48;
    const north = (mask & 1) !== 0;
    const east = (mask & 2) !== 0;
    const south = (mask & 4) !== 0;
    const west = (mask & 8) !== 0;

    p.rect(x, y, 16, 48, c.wall);
    if (!north) {
      p.rect(x, y, 16, 3, c.trim);
      p.rect(x + (west ? 0 : 2), y + 3, 16 - (west ? 0 : 2) - (east ? 0 : 2), 1, c.woodLight);
    }
    if (!south) {
      p.rect(x, y + 41, 16, 2, c.wallShade);
      p.rect(x, y + 43, 16, 5, c.trim);
      p.rect(x + (west ? 0 : 2), y + 44, 16 - (west ? 0 : 2) - (east ? 0 : 2), 1, c.woodLight);
    }
    // Bei N/S-Nachbarn überlappen die hohen Bilder um 32 Pixel. Ihre
    // Seitenkanten müssen deshalb über die gesamte Bildhöhe durchlaufen.
    if (!west) {
      p.rect(x, y, 2, 48, c.trim);
      p.rect(x + 2, y + (north ? 0 : 3), 1, (south ? 48 : 41) - (north ? 0 : 3), c.woodLight);
    }
    if (!east) {
      p.rect(x + 14, y, 2, 48, c.trim);
      p.rect(x + 13, y + (north ? 0 : 3), 1, (south ? 48 : 41) - (north ? 0 : 3), c.wallShade);
    }
  }
  return p;
}

/** Passierbare Türöffnung: Rahmen und Lichtkante, die Mitte bleibt transparent. */
export function doorOpen(c: Palette): Pixels {
  const p = new Pixels(32, 48);
  p.rect(0, 0, 32, 4, c.woodDark);
  p.rect(2, 4, 5, 44, c.woodShade);
  p.rect(25, 4, 5, 44, c.woodDark);
  p.rect(4, 5, 3, 41, c.woodLight);
  p.rect(25, 5, 3, 41, c.woodLight);
  p.rect(7, 4, 18, 2, c.woodLight);
  p.rect(8, 7, 16, 1, c.wallShade);
  p.rect(4, 45, 24, 3, c.trim);
  p.rect(7, 44, 18, 1, c.woodLight);
  p.rect(25, 26, 2, 2, '#f0d29b');
  return p;
}

/** Große Pflanzschale mit drei ruhigen Blattformen. */
export function planter(c: Palette): Pixels {
  const p = new Pixels(48, 48);
  p.rect(23, 8, 3, 25, c.leafDark);
  p.box(8, 10, 17, 11, c.leafDark, 2);
  p.rect(10, 11, 13, 5, c.leaf);
  p.rect(12, 11, 9, 2, c.leafLight);
  p.box(22, 4, 18, 12, c.leafDark, 2);
  p.rect(24, 5, 14, 6, c.leaf);
  p.rect(26, 5, 9, 2, c.leafLight);
  p.box(25, 18, 16, 12, c.leafDark, 2);
  p.rect(27, 19, 12, 6, c.leaf);
  p.rect(29, 19, 8, 2, c.leafLight);
  p.rect(8, 29, 32, 4, c.woodDark);
  p.rect(10, 32, 28, 13, c.accent);
  p.rect(12, 33, 24, 3, c.woodLight);
  p.rect(14, 36, 20, 8, c.woodShade);
  p.rect(16, 37, 16, 6, c.accent);
  p.rect(12, 43, 24, 2, c.woodDark);
  return p;
}

/** Niedrige Bank für Ankunfts- und Gartenbereiche. */
export function bench(c: Palette): Pixels {
  const p = new Pixels(64, 32);
  p.rect(5, 25, 8, 5, c.woodDark);
  p.rect(51, 25, 8, 5, c.woodDark);
  p.box(1, 9, 62, 17, INK, 2);
  p.rect(3, 10, 58, 10, c.wood);
  p.rect(4, 11, 56, 2, c.woodLight);
  p.rect(3, 20, 58, 5, c.woodShade);
  p.rect(8, 17, 16, 2, c.woodLight);
  p.rect(39, 16, 17, 2, c.woodLight);
  p.rect(7, 26, 10, 2, c.woodDark);
  p.rect(47, 26, 10, 2, c.woodDark);
  p.rect(27, 13, 10, 5, c.fabricShade);
  p.rect(28, 13, 8, 3, c.fabricLight);
  return p;
}

/** Kleine Pflanze für schmale Regale und Fensterbänke. */
export function plantSmall(c: Palette): Pixels {
  const p = new Pixels(16, 32);
  p.rect(7, 7, 2, 17, c.leafDark);
  p.box(2, 12, 8, 9, c.leafDark, 2);
  p.rect(4, 13, 5, 4, c.leaf);
  p.rect(5, 13, 3, 1, c.leafLight);
  p.box(7, 4, 8, 8, c.leafDark, 2);
  p.rect(8, 5, 5, 4, c.leaf);
  p.rect(9, 5, 3, 1, c.leafLight);
  p.rect(4, 22, 8, 9, c.woodDark);
  p.rect(5, 23, 6, 7, c.accent);
  p.rect(4, 29, 8, 2, c.woodLight);
  return p;
}
