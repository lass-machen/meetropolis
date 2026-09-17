import { extraHat, extraHatNames } from './avatar-accessories.ts';
import type { Grid, SpriteCatalog, View } from '../../../packages/shared/src/sprite/types.ts';

/** Eigenständige Pixelvorlagen: breite Haarmassen, kleine Gesichter, kurze Körper. */
function raster(x: number, y: number, lines: string[]): Grid {
  const result = Array.from({ length: 32 }, () => Array<string>(32).fill('.'));
  lines.forEach((line, dy) =>
    [...line].forEach((ink, dx) => {
      if (x + dx < 0 || x + dx >= 32 || y + dy < 0 || y + dy >= 32)
        throw new Error('Die kompakte Figur überschreitet ihr Pixelraster.');
      result[y + dy][x + dx] = ink;
    }),
  );
  return result.map((row) => row.join(''));
}

function contour(grid: Grid): Grid {
  const pixels = grid.map((row) => [...row]);
  grid.forEach((row, y) =>
    [...row].forEach((ink, x) => {
      if (ink === '.') return;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx >= 0 && nx < 32 && ny >= 0 && ny < 32 && grid[ny][nx] === '.') pixels[ny][nx] = 'O';
      }
    }),
  );
  return pixels.map((row) => row.join(''));
}

/** Ruhige Wangenkontur; Ohren ragen nicht seitlich aus der kurzen Kopfform. */
function compactHead(): Grid {
  const lower = ['.cbbbbbbbbbbc.', '.ccbbbbbbbbcc.', '..ccbbbbbbcc..', '...cccccccc...'];
  return contour(
    raster(9, 6, [
      '..cccccccccc..',
      '.cbbbbbbbbbbc.',
      'cbbbbbbbbbbbbc',
      'cbbbbbbbbbbbbc',
      'cbbbbbbbbbbbbc',
      'cbbbbbbbbbbbbc',
      'cbbbbbbbbbbbbc',
      'cbbbbbbbbbbbbc',
      ...lower,
      '......cb......',
      '......cb......',
    ]),
  );
}

const frontHair = [
  '.....OOOOOO.......',
  '...OOiihhhiOO.....',
  '..OihhhhhhhiiO....',
  '.OihhhhhiiiiiOO...',
  '.OihhhiiiiiiiiiO..',
  'OihhiiiiiiijjiiO..',
  'OiiiiiiijjjjjjiiO.',
  'Oiiiijjjjj..jjiiO.',
  'Oijjj..jj....jiiO.',
  'Oij..........jiO..',
  '.Oj..........jO...',
  '.Oj..........jO...',
];
const rearHair = [
  '.....OOOOOO.......',
  '...OOiihhiiOO.....',
  '..OihhhhhiiiiO....',
  '.OihhhhhhiiiiiO...',
  '.OihhhhiiiiiiiiO..',
  'OihhiiiiiiiiiiiO..',
  'OiiiiiiiiiiiiiiiO.',
  'OiiiiiiiiiiiiiiiO.',
  'OiiiiiiiiiiiiijiO.',
  '.OiiiiiiiiiiijjO..',
  '.OijiiiiiiijjjjO..',
  '..OjjjjjjjjjjjO...',
  '...OOjjjjjjjOO....',
  '.....OOOOOOO......',
];
const sideHair = [
  '....OOOOOO......',
  '..OOihhhiiOO....',
  '.OihhhhhiiiiO...',
  'OihhhhhhiiiiiO..',
  'OihhhiiiiiiiiO..',
  'OiiiiiiiiiiiiiO.',
  'OiiiijiiiiiiiiO.',
  'Oijj..jiiiiiiiO.',
  '.Oj...jiiiiijiO.',
  '......jiiijjjjO.',
  '......jijjjjjO..',
  '......jjjjjjjO..',
  '.......OOOOOO...',
];

function hairstyle(view: View, name: string, covered: boolean): Grid {
  if (name === 'bald') return raster(0, 0, []);
  let lines = [...(view === 'front' ? frontHair : view === 'rear' ? rearHair : sideHair)];
  const x = view === 'side' ? 9 : 7;
  const y = 3;
  if (name === 'buzz') lines = lines.slice(0, 6).map((line) => line.replaceAll('h', 'i'));
  if (name === 'side_part') {
    lines[5] = view === 'side' ? 'OiiiijiiiiiiiiO..' : 'OiiiiihhijiiiiiiO..';
    if (view === 'front') {
      lines[7] = 'Oiiiijjj.OijjiiiO.';
      lines[8] = 'Oijjj....OjjjiiiO.';
    }
  }
  if (name === 'curly') {
    lines[0] = '...OO..OO.OO......';
    lines[1] = '..OhiOOhiOhiOO....';
    lines[2] = '.OhhhihhhihhiiO...';
    lines[4] = '.OhiiihiiiihiiiO..';
    lines[6] = view === 'front' ? 'OiiiijjiijjiiiiiO.' : 'OiiiihiiihiiiiiO..';
  }
  if (name === 'spiky') {
    lines[0] = '....OO..OO........';
    lines[1] = '..OOhiOOhiOO......';
    lines[2] = '.OihhhihhhiiOO....';
    lines[3] = 'OihhhhiiiiiihhO...';
  }
  const pixels = raster(x, y, lines).map((row) => [...row]);
  const put = (px: number, py: number, text: string) =>
    [...text].forEach((ink, dx) => {
      pixels[py][px + dx] = ink;
    });
  if (['long', 'bob'].includes(name)) {
    const end = name === 'bob' ? 19 : 24;
    // Die Längen setzen die Haarkappe fort und schließen gemeinsam am Nacken.
    // Ihre vollständigen Zeilen ersetzen auch die alte kurze Abschlusskontur.
    const lengths =
      view === 'front'
        ? ['.Oij..........jiO.', '..Oij........jjO..', '...OO........OO...']
        : view === 'rear'
          ? ['.OihiiiiiiiijjjjO.', '..OijjjjjjjjjjjO..', '...OOOOOOOOOOOO...']
          : ['......jiiiiijjO.', '.......jjjjjO...', '........OOOO....'];
    for (let py = 12; py < end; py++) {
      pixels[py].fill('.');
      put(x, py, lengths[py < end - 2 ? 0 : py === end - 2 ? 1 : 2]);
    }
  }
  if (name === 'braids') {
    const braid = ['.OijO', 'OihjO', '.OijO', '.OhjO', 'OihjO', '.OijO', '.OjO.', '.OhO.', '..O..'];
    const stampBraid = (px: number, py: number, mirrored: boolean) =>
      braid.forEach((row, dy) => put(px, py + dy, mirrored ? [...row].reverse().join('') : row));
    if (view === 'side') stampBraid(20, 13, false);
    else {
      stampBraid(7, 13, false);
      stampBraid(20, 13, true);
    }
  }
  if (name === 'ponytail')
    for (let py = 10; py < 22; py++) put(view === 'rear' ? 20 : 23, py, py === 10 || py === 21 ? '.OO.' : 'OijO');
  if (name === 'bun') {
    put(13, 0, '.OOOO.');
    put(13, 1, 'OhhiiO');
    put(13, 2, 'OiijjO');
    put(13, 3, '.OOOO.');
  }
  // Unter geschlossenen Hüten bleiben nur seitliche Längen und der Hinterkopf.
  if (covered) for (let py = 0; py < 10; py++) pixels[py].fill('.');
  return pixels.map((row) => row.join(''));
}

function hood(view: View): Grid {
  const front = [
    '......OOOOOO......',
    '....OOttuuvvOO....',
    '...OttttuuvvvvO...',
    '..OttttuuuvvvvvO..',
    '.OttttuuuuvvvvvvO.',
    '.OttuuuuuuvvvvvvO.',
    'OttuuvvvvvvvvvvvvO',
    'Ottuvv......vvvvvO',
    'Ottu..........vvvO',
    'Ottv..........vvvO',
    'Ottv..........vvvO',
    'Ottv..........vvvO',
    'Ottv..........vvvO',
    '.Otv..........vvO.',
    '.Otvv........vvvO.',
    '..OvvvvvvvvvvvvO..',
    '...OuvvvvvvvvvO...',
    '....OOvvvvvvOO....',
    '......OOOOOO......',
  ];
  const rear = [
    '......OOOOOO......',
    '....OOttuuvvOO....',
    '...OttttuuvvvvO...',
    '..OttttuuuvvvvvO..',
    '.OttttuuuuvvvvvvO.',
    '.OttuuuuuuvvvvvvO.',
    'OttuuuuuuuvvvvvvvO',
    'OttuuuuuuuvvvvvvvO',
    'OttuuuuuuuvvvvvvvO',
    'OttuuuuuuuvvvvvvvO',
    'OttuuuuuuuvvvvvvvO',
    'OtuuuuuuuuvvvvvvvO',
    'OuuuuuuuuvvvvvvvvO',
    '.OuuuuuuvvvvvvvvO.',
    '.OuuuuuvvvvvvvvvO.',
    '..OvvvvvvvvvvvvO..',
    '...OvvvvvvvvvvO...',
    '....OOvvvvvvOO....',
    '......OOOOOO......',
  ];
  const side = [
    '....OOOOOO.....',
    '..OOttuuvvOO...',
    '.OttttuuuvvvO..',
    'OttttuuuuvvvvO.',
    'OttuuuuuuvvvvO.',
    'OtuuvuuuvvvvvvO',
    'OtvvvuuvvvvvvvO',
    'Ov...vuuvvvvvvO',
    '.....vuuvvvvvvO',
    '.....vuuvvvvvvO',
    '.....vuuvvvvvvO',
    '.....vuuvvvvvvO',
    '.....vuuvvvvvvO',
    '.v...vuuvvvvvO.',
    '.OvvvvvvvvvvvO.',
    '..OvvvvvvvvvO..',
    '...OOvvvvvOO...',
    '.....OOOOO.....',
  ];
  return raster(view === 'side' ? 9 : 7, 2, view === 'front' ? front : view === 'rear' ? rear : side);
}

function glasses(view: View, style: string): Grid {
  const pixels = raster(0, 0, []).map((row) => [...row]);
  const put = (x: number, y: number, lines: string[]) =>
    lines.forEach((row, dy) =>
      [...row].forEach((ink, dx) => {
        if (ink !== '.') pixels[y + dy][x + dx] = ink;
      }),
    );
  const lens = style === 'round' ? ['.GG.', 'G..G', 'G..G', '.GG.'] : ['GGGG', 'G..G', 'G..G', 'GGGG'];
  if (view === 'front') {
    put(11, 12, lens);
    put(16, 12, lens);
    put(15, 13, ['G']);
    if (style === 'prof') put(10, 11, ['GGGGGGGGGGGG']);
  } else {
    put(10, 12, lens);
    put(14, 13, ['GGGGGG']);
    if (style === 'prof') put(9, 11, ['GGGGG']);
  }
  return pixels.map((row) => row.join(''));
}

function beard(view: View, style: string): Grid {
  if (view === 'front') {
    if (style === 'schnauzer') return raster(13, 15, ['ff.ff', '.f.f.']);
    if (style === 'ziegenbart') return raster(15, 17, ['ff', 'gg', '.O']);
    return raster(10, 15, ['ff........ff', 'gff......ffg', '.gffffffffg.', '..ggffffgg..', '...gggggg...']);
  }
  if (style === 'schnauzer') return raster(9, 15, ['fff', '.f.']);
  if (style === 'ziegenbart') return raster(11, 17, ['ff', '.g', '.O']);
  return raster(9, 15, ['.ff...', 'f..f..', '.ffff.', '..fgfO', '...OO.']);
}

function top(view: View, mode: string, style: string): Grid {
  const front = [
    '...OccO.....',
    '..OtuuuvO...',
    '.OttuuuvvO..',
    'OttuuuuuvvO.',
    'OtvuuuuuvvO.',
    '.OvuuuuuuvO.',
    '..OvvvvvvO..',
    '..OOOOOOOO..',
  ];
  const rear = [
    '...OOOO.....',
    '..OtuuuvO...',
    '.OttuuuvvO..',
    'OttuuuuuvvO.',
    'OtvuuuuuvvO.',
    '.OvuuuuuuvO.',
    '..OvvvvvvO..',
    '..OOOOOOOO..',
  ];
  const side = ['..OOO...', '.OtuvO..', 'OttuuvO.', 'OtuuvvO.', 'OuuuvvO.', 'OuuuvvO.', '.OvvvvO.', '.OOOOO..'];
  const lines = [...(view === 'side' ? side : view === 'rear' ? rear : front)];
  if (view !== 'side') {
    // Hals und Kinn gehören nur zur beweglichen Kopfebene. Kleidung umschließt
    // die mittigen Halspixel, ohne dort Haut oder eine zweite Kontur zu malen.
    lines[0] = '............';
    lines[1] = '...Ot..vO...';
  }
  if (mode === 'base')
    return raster(
      view === 'side' ? 12 : 10,
      18,
      lines.map((line) => line.replaceAll('t', 'a').replaceAll('u', 'b').replaceAll('v', 'c')),
    );
  if (view === 'front' && ['suit_navy', 'blazer_anthracite'].includes(style)) {
    lines[1] = '...Ot..vO...';
    lines[2] = '.OtvtWtvvO..';
    lines[3] = 'OttuOWOuvvO.';
    lines[4] = 'OtvuuWtuvvO.';
    lines[5] = '.OvuuttuvvO.';
  }
  if (view === 'front' && style === 'hoodie_blue') {
    lines[1] = '...Ot..vO...';
    lines[2] = '.OttvvuuvO..';
    lines[4] = 'OtvuvvvuvvO.';
    lines[5] = '.OvuuttuvvO.';
  }
  if (mode === 'dress') {
    if (view === 'side') {
      lines[6] = 'OttuvvvO';
      lines[7] = 'OvvvvvvO';
      lines.push('.OOOOOO.');
    } else {
      lines[5] = '.OtuuutuvvO.';
      lines[6] = 'OttuuvtuvvvO';
      lines[7] = 'OvvvvvvvvvvO';
      lines.push('.OOOOOOOOOO.');
    }
  }
  return raster(view === 'side' ? 12 : 10, 18, lines);
}

/** Der bestehende Composer bekommt neue Raster, keine nachbearbeiteten PNGs. */
export function applyCompactStyle(catalog: SpriteCatalog, covered: boolean): SpriteCatalog {
  const put = (path: string, value: Grid): void => {
    const keys = path.split('.');
    let node = catalog.catalogs;
    for (const key of keys.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>;
    node[keys.at(-1)!] = value;
  };
  // Konturen sind Teil jeder beweglichen Ebene und folgen deren Animation.
  const outlineTree = (node: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) node[key] = contour(value as Grid);
      else if (value && typeof value === 'object' && key !== 'palette') outlineTree(value as Record<string, unknown>);
    }
  };
  for (const key of ['bodies', 'bottoms', 'tops', 'hats', 'hood'])
    outlineTree(catalog.catalogs[key] as Record<string, unknown>);
  for (const name of Object.keys(extraHatNames))
    for (const view of ['front', 'side', 'rear'] as const) put(`hats.${name}.${view}`, extraHat(view, name));
  put('bodies.body.front', compactHead());
  put('bodies.body.rear', compactHead());
  (catalog.catalogs.hats as Record<string, { palette: Record<string, string> }>).cap.palette = {
    A: '#92b8bf',
    B: '#61779c',
    C: '#414863',
  };
  catalog.palettes.outline = { O: '#403548' };
  catalog.palettes.face = { E: '#352c43', W: '#fff0dc', M: '#b36d69' };
  catalog.palettes.top = {
    shirt_white: { t: '#f6e8ce', u: '#d9d9c7', v: '#929e9b' },
    hoodie_blue: { t: '#91b6c4', u: '#5e829f', v: '#485974' },
    suit_navy: { t: '#797b99', u: '#565879', v: '#3d3e59' },
    blazer_anthracite: { t: '#939c9b', u: '#707c7e', v: '#515b65' },
    dress_red: { t: '#de8879', u: '#b85364', v: '#7c4059' },
  };
  catalog.palettes.hair = {
    braun: { h: '#b87d58', i: '#84584a', j: '#573d43' },
    blond: { h: '#f8d77b', i: '#daa157', j: '#aa7051' },
    schwarz: { h: '#71778c', i: '#4c526b', j: '#35364f' },
    rot: { h: '#f6b164', i: '#dd7950', j: '#a7474b' },
    grau: { h: '#d2dbcf', i: '#a0b4b0', j: '#70858e' },
  };
  catalog.palettes.beard = Object.fromEntries(
    Object.entries(catalog.palettes.hair).map(([key, value]) => {
      const p = value as Record<string, string>;
      return [key, { e: p.h, f: p.i, g: p.j }];
    }),
  );
  for (const view of ['front', 'side', 'rear'] as const) {
    put(`hood.${view}`, hood(view));
    for (const name of Object.keys(catalog.catalogs.hairstyles as object))
      put(`hairstyles.${name}.${view}`, hairstyle(view, name, covered));
    for (const style of Object.keys(catalog.palettes.top))
      put(`compact_tops.${style}.${view}`, top(view, 'trousers', style));
    put(`tops.dress.${view}`, top(view, 'dress', 'dress_red'));
    put(`bodies.torso_bare.${view}`, top(view, 'base', ''));
    if (view === 'rear') continue;
    for (const name of ['round', 'rect', 'prof']) put(`glasses.${name}.${view}`, glasses(view, name));
    for (const name of ['schnauzer', 'vollbart', 'ziegenbart']) put(`beards.${name}.${view}`, beard(view, name));
    for (const name of ['ruhig', 'freundlich', 'wach']) {
      let lines =
        name === 'wach'
          ? ['EW...WE', 'E.....E', '.......', '..MM...']
          : name === 'freundlich'
            ? ['E.....E', '.......', '..M.M..', '...M...']
            : ['E.....E', 'E.....E', '.......', '...M...'];
      if (view === 'side')
        lines =
          name === 'wach'
            ? ['EW', 'E.', '..', 'M.']
            : name === 'freundlich'
              ? ['E.', '..', 'MM', '.M']
              : ['E.', 'E.', '..', 'M.'];
      put(`lab_faces.${name}.${view}`, raster(view === 'side' ? 11 : 12, 13, lines));
    }
  }
  const legs = ['OppppppppO', 'OppqqqqppO', 'OppO..OppO', 'OppO..OppO', '.OO....OO.'];
  put('bottoms.trousers.front', raster(11, 24, legs));
  for (const mode of ['full', 'dress'])
    put(
      `bodies.legs_bare_${mode}.front`,
      raster(
        11,
        24,
        legs.map((line) => line.replaceAll('p', 'b').replaceAll('q', 'c')),
      ),
    );
  for (const [slot, x] of [
    ['front_l', 11],
    ['front_r', 17],
  ] as const) {
    put(`bottoms.shoes.${slot}`, raster(x, 27, ['.ss.', 'OrsO', 'OOOO']));
    put(`bodies.feet_bare.${slot}`, raster(x, 27, ['.cc.', 'ObcO', 'OOOO']));
  }
  for (const view of ['front', 'side', 'rear'])
    catalog.compose.outfits.trousers.slots[`top_${view}`] = `compact_tops.{top}.${view}`;
  return catalog;
}
