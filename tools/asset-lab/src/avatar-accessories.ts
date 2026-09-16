import type { Grid, SpriteCatalog, View } from '../../../packages/shared/src/sprite/types.ts';

export const extraHatNames = {
  beanie: 'Beanie',
  fedora: 'Filzhut',
  headset: 'Headset',
  party: 'Partyhut',
  propeller: 'Propeller-Cap',
  cat: 'Katzenmütze',
};
export const extraBeardNames = {
  stubble: 'Dreitagebart',
  trimmed: 'Kurzer Vollbart',
  long_beard: 'Langer Bart',
  handlebar: 'Zwirbelbart',
};

export interface AccessoryHead {
  headX: number;
  headY: number;
  headWidth: number;
  headHeight: number;
  mouthX: number;
  mouthY: number;
}

/** Kopfbreite und Stirn führen Hüte; Bärte folgen dem Mund und behalten ihre Länge. */
function fitHead(grid: Grid, view: View, head: AccessoryHead, beard: boolean): Grid {
  const side = view === 'side';
  const scaleX = head.headWidth / (side ? 11 : 14);
  const sourceX = beard && side ? 11 : side ? 15.5 : 16;
  const targetX = beard && side ? head.mouthX : head.headX + head.headWidth / 2;
  const sourceY = beard ? 16 : 6;
  const targetY = beard ? head.mouthY : head.headY;
  const scaleY = beard ? 1 : head.headHeight / 12;
  return Array.from({ length: 32 }, (_, y) =>
    Array.from({ length: 32 }, (_, x) => {
      const sx = Math.floor(sourceX + (x + 0.5 - targetX) / scaleX);
      const sy = Math.floor(sourceY + (y + 0.5 - targetY) / scaleY);
      return grid[sy]?.[sx] ?? '.';
    }).join(''),
  );
}

function raster(x: number, y: number, lines: string[]): Grid {
  const rows = Array.from({ length: 32 }, () => Array<string>(32).fill('.'));
  lines.forEach((row, dy) =>
    [...row].forEach((ink, dx) => {
      if (x + dx >= 32 || y + dy >= 32) throw new Error('Zubehör überschreitet das Figurenraster.');
      rows[y + dy][x + dx] = ink;
    }),
  );
  return rows.map((row) => row.join(''));
}

/** Kleine Bartmassen lassen die Mundmitte frei; der Composer bewegt sie mit dem Kopf. */
export function extraBeard(view: View, style: string, head?: AccessoryHead): Grid {
  const front: Record<string, string[]> = {
    stubble: ['f........f', '.f......f.', '..f....f..', '...f.ff...'],
    trimmed: ['ff........ff', 'gff......ffg', '.gffffffffg.', '..ggffffgg..'],
    long_beard: [
      'ff........ff',
      'gff......ffg',
      '.gffffffffg.',
      '.ggffffffgg.',
      '..gfefffgg..',
      '..gfeffgg...',
      '...gffgg....',
      '....ggg.....',
      '.....O......',
    ],
    handlebar: ['f.........f', 'ef.ff.ff.fe', '.gfffffff.g', '...gg.gg...'],
  };
  const side: Record<string, string[]> = {
    stubble: ['.f...', '.f...', '..f.f', '...f.'],
    trimmed: ['.ff...', 'f..f..', '.ffff.', '..ggg.'],
    long_beard: ['.ff...', 'f..f..', '.ffff.', '.gfffO', '.gfffO', '..gffO', '..ggfO', '...ggO', '....O.'],
    handlebar: ['f....', 'ef.ff', '.gfff', '...gg'],
  };
  const pixels = raster(
    view === 'side' ? 10 : style === 'stubble' ? 11 : 10,
    15,
    (view === 'side' ? side : front)[style],
  );
  return head ? fitHead(pixels, view, head, true) : pixels;
}

/** Eigene Kopfansichten mit festen Lichtkanten; keine gedrehten PNGs. */
export function extraHat(view: View, style: string, head?: AccessoryHead): Grid {
  const side = view === 'side',
    rear = view === 'rear';
  const x = side ? 8 : 7;
  let y = 2;
  let lines: string[];
  if (style === 'beanie') {
    lines = side
      ? [
          '.....OOOO....',
          '...OOAAABOO..',
          '..OAAABBBBCO.',
          '.OAABBBBBCCO.',
          '.OABBBBBBCCO.',
          'OAAAAABBBCCCO',
          'OBBBBBBCCCCCO',
          '.OOOOOOOOOOO.',
        ]
      : [
          '......OOOOOO......',
          '....OOAAAABBOO....',
          '...OAAAABBBBBBO...',
          '..OAAAABBBBBBCCO..',
          '.OAAAABBBBBBBCCCO.',
          '.OAABBBBBBBBBCCCO.',
          'OAAAAAAABBBBBCCCCO',
          'OBBBBBBBBBCCCCCCCO',
          '.OOOOOOOOOOOOOOOO.',
        ];
  } else if (style === 'fedora') {
    lines = side
      ? [
          '...OOOOOO....',
          '..OAAABBCO...',
          '..OABBCCCO...',
          '..OABBBCCO...',
          '..ODDDDDDO...',
          'OOAABBBBCCCO.',
          '.OOOOOOOOOOO.',
        ]
      : [
          '....OOOOOOOOO.....',
          '...OAAAABBCCCO....',
          '...OAABBBBCCCO....',
          '...OABBBBBCCCO....',
          '...ODDDDDDDDDO....',
          '.OOAAAAABBBBBCCOO.',
          'OAAAAABBBBBBCCCCCO',
          '.OOOOOOOOOOOOOOOO.',
        ];
    y = 3;
  } else if (style === 'party') {
    lines = side
      ? [
          '......DO.....',
          '.....OADO....',
          '.....OAADO...',
          '....OAABBO...',
          '....OBBDBBO..',
          '...OAABBBBO..',
          '...OADDBBBCO.',
          '..OAAABBBCCO.',
          '..ODDDDDDDDO.',
          '...OOOOOOOO..',
        ]
      : [
          '........DO........',
          '.......OADO.......',
          '.......OAADO......',
          '......OAAABO......',
          '......OBBDBBO.....',
          '.....OAABBBBO.....',
          '.....OADDBBBCO....',
          '....OAAAABBBBCO...',
          '...ODDDDDDDDDDDO..',
          '....OOOOOOOOOOO...',
        ];
    y = 0;
  } else if (style === 'propeller') {
    lines = side
      ? [
          '...DDD.OAAA....',
          '......OO......',
          '......BO......',
          '...OOAABBOO...',
          '..OAAABBBCCO..',
          '.OAAABBBBCCCO.',
          '.OABBBBBBCCCO.',
          'OOAAAABBBCCCO.',
          '.OOOOOOOOOOO..',
        ]
      : [
          '....DDDDOAAAA.....',
          '........O.........',
          '........B.........',
          '....OOAABBCCOO....',
          '...OAAAABBBCCCO...',
          '..OAAAABBBBBCCCO..',
          '.OAAAAABBBBBBCCCO.',
          '.OAAABBBBBBBBCCCO.',
          'OOAAAAAABBBBBCCCCO',
          '.OOOOOOOOOOOOOOOO.',
        ];
    y = 0;
  } else if (style === 'cat') {
    lines = side
      ? [
          '...OO.....OO...',
          '..OADO...OBCO..',
          '..OAADOOABBCCO.',
          '.OAAABBBBBCCCO.',
          '.OAABBBBBBCCCO.',
          'OAABBBBBBBCCCO.',
          'OABBBBBBBBCCCO.',
          'OBBBBBBBBBCCCO.',
          '.OOOOOOOOOOOO..',
        ]
      : [
          '..OO..........OO..',
          '.OAADO......ODBCO.',
          '.OAADDOOOOOODBBCCO',
          '.OAAAABBBBBBBCCCO.',
          '.OAAABBBBBBBBCCCO.',
          'OAAABBBBBBBBBCCCCO',
          'OAAABBBBBBBBBCCCCO',
          'OABBBBBBBBBBBCCCCO',
          '.OOOOOOOOOOOOOOOO.',
        ];
    y = 1;
  } else {
    // Der offene Bügel verdeckt keine Frisur; das Mikrofon bleibt vor der Wange.
    lines = side
      ? [
          '.......OOO.....',
          '......OAAAO....',
          '......O...O....',
          '.....O....O....',
          '.....O....O....',
          '.....O...OBBO..',
          '.....O...OBCO..',
          '.....O...OBCO..',
          '.........OBBO..',
          '..........OO...',
          '.......OOO.....',
          '....OOO........',
          '...ODO.........',
        ]
      : [
          '.....OOOOOOOO.....',
          '...OOAAAAAAABOO...',
          '..O............O..',
          '..O............O..',
          '.O..............O.',
          '.O..............O.',
          'OBBO..........OBBO',
          'OBCO..........OBCO',
          'OBCO..........OBCO',
          'OBBO..........OBBO',
          '.OO..........OO.O.',
          '..........OOO.....',
          '........ODO.......',
        ];
    y = 4;
    if (rear) lines = lines.slice(0, 11);
  }
  const pixels = raster(x, y, lines);
  return head ? fitHead(pixels, view, head, false) : pixels;
}

export function addAccessories(catalog: SpriteCatalog): void {
  // Der ursprüngliche Katalog besitzt breitere Seitenköpfe als die kompakten Formen.
  const originalHead = (view: View): AccessoryHead => ({
    headX: 8,
    headY: 6,
    headWidth: 15,
    headHeight: 12,
    mouthX: view === 'side' ? 10 : 15,
    mouthY: 16,
  });
  const hats = catalog.catalogs.hats as Record<string, unknown>;
  for (const name of Object.keys(extraHatNames)) {
    hats[name] = {
      front: extraHat('front', name, originalHead('front')),
      side: extraHat('side', name, originalHead('side')),
      rear: extraHat('rear', name, originalHead('rear')),
      palette: { A: '#d8c8a5', B: '#8e9a9f', C: '#596779', D: '#de8879' },
    };
    if (!catalog.compose.config_fields.hat.values.includes(name)) catalog.compose.config_fields.hat.values.push(name);
  }
  const beards = catalog.catalogs.beards as Record<string, unknown>;
  for (const name of Object.keys(extraBeardNames)) {
    beards[name] = {
      front: extraBeard('front', name, originalHead('front')),
      side: extraBeard('side', name, originalHead('side')),
    };
    if (!catalog.compose.config_fields.beard.values.includes(name))
      catalog.compose.config_fields.beard.values.push(name);
  }
  // Mund und Augen bleiben bei jeder Körperform über dem Bart sichtbar.
  for (const view of ['front', 'side'] as const) {
    const layout = catalog.compose.part_layout[view];
    const faceIndex = layout.findIndex((part) => part.slot === `face_${view}`);
    const [face] = layout.splice(faceIndex, 1);
    const beardIndex = layout.findIndex((part) => part.slot === `beard_${view}`);
    layout.splice(beardIndex + 1, 0, face);
  }
}
