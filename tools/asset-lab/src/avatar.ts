import { addAccessories, extraHatNames, extraBeardNames } from './avatar-accessories.ts';
export { extraHatNames, extraBeardNames };
import catalogData from '../../../packages/shared/sprite/catalog.json' with { type: 'json' };
import { createProportionCatalog, proportions, type ProportionId } from './avatar-proportions.ts';
export { proportions, type ProportionId } from './avatar-proportions.ts';
import {
  assertSpriteCatalog,
  composeSheet,
  validateConfig,
  type AvatarConfig,
  type RgbaImage,
} from '../../../packages/shared/src/sprite/index.ts';

export const faceNames = {
  ruhig: 'Ruhig',
  freundlich: 'Freundlich',
  wach: 'Wach',
} as const;
export type FaceId = keyof typeof faceNames;
export interface Character extends AvatarConfig {
  face: FaceId;
  proportion?: ProportionId;
}

export const defaultCharacter: Character = {
  skin: 'medium',
  hair: 'messy',
  hair_color: 'braun',
  outfit: 'trousers',
  top: 'hoodie_blue',
  pants: 'dark',
  shoes: 'brown',
  beard: null,
  beard_color: 'braun',
  glasses: null,
  hat: null,
  misc: null,
  face: 'ruhig',
};

/** Neue Gesichtsebenen: feste Pixel, die der vorhandenen Kopfanimation folgen. */
function grid(points: [number, number, string][]): string[] {
  const rows = Array.from({ length: 32 }, () => Array<string>(32).fill('.'));
  for (const [x, y, pixels] of points)
    [...pixels].forEach((pixel, dx) => {
      rows[y][x + dx] = pixel;
    });
  return rows.map((row) => row.join(''));
}

const catalog = assertSpriteCatalog(structuredClone(catalogData));
addAccessories(catalog);
// Der lokale Baukasten koppelt die Bartfarbe an die Haare, einschließlich Rot.
catalog.palettes.beard = {
  ...catalogData.palettes.beard,
  rot: {
    e: catalogData.palettes.hair.rot.h,
    f: catalogData.palettes.hair.rot.i,
    g: catalogData.palettes.hair.rot.j,
  },
};
catalog.compose.config_fields.beard_color.values.push('rot');
catalog.catalogs.lab_faces = {
  ruhig: {
    front: grid([
      [12, 11, 'RR....RR'],
      [12, 13, 'EE....EE'],
      [12, 14, 'EE....EE'],
      [15, 16, 'MM'],
    ]),
    side: grid([
      [10, 11, 'RR'],
      [10, 13, 'EE'],
      [10, 14, 'EE'],
      [10, 16, 'M'],
    ]),
  },
  freundlich: {
    front: grid([
      [12, 11, 'RR....RR'],
      [12, 13, 'EE....EE'],
      [12, 14, 'EW....WE'],
      [14, 16, 'M..M'],
      [15, 17, 'MM'],
    ]),
    side: grid([
      [10, 11, 'RR'],
      [10, 13, 'EE'],
      [10, 14, 'WE'],
      [10, 16, 'MM'],
      [11, 17, 'M'],
    ]),
  },
  wach: {
    front: grid([
      [12, 10, 'RRR..RRR'],
      [12, 12, 'EE....EE'],
      [12, 13, 'EW....WE'],
      [12, 14, 'EE....EE'],
      [15, 16, 'MM'],
    ]),
    side: grid([
      [10, 10, 'RRR'],
      [10, 12, 'EE'],
      [10, 13, 'WE'],
      [10, 14, 'EE'],
      [10, 16, 'M'],
    ]),
  },
};
catalog.compose.base_kit.face_front = 'lab_faces.{face}.front';
catalog.compose.base_kit.face_side = 'lab_faces.{face}.side';

const proportionCatalogs = new Map<string, typeof catalog>();
function characterCatalog(config: Character): typeof catalog {
  if (!config.proportion) return catalog;
  const covered = ['cap', 'cowboy', 'zylinder', 'bierhelm', 'beanie', 'fedora', 'propeller', 'cat'].includes(
    config.hat ?? '',
  );
  const key = `${config.proportion}/${covered}`;
  let selected = proportionCatalogs.get(key);
  if (!selected) {
    selected = createProportionCatalog(catalog, config.proportion, covered);
    proportionCatalogs.set(key, selected);
  }
  return selected;
}

export function characterSheet(config: Character): RgbaImage {
  return composeSheet(characterCatalog(config), config);
}

export function hairColorsFor(config: Character): Record<string, string> {
  const palette = characterCatalog(config).palettes.hair as Record<string, Record<string, string>>;
  return Object.fromEntries(Object.entries(palette).map(([id, colors]) => [id, colors.i]));
}

export const compactLooks: Record<string, { name: string; character: Partial<Character> }> = {
  studio: {
    name: 'Studio · Feminin',
    character: {
      proportion: 'kompakt_weich',
      hair: 'bob',
      hair_color: 'schwarz',
      beard_color: 'schwarz',
      top: 'blazer_anthracite',
      outfit: 'trousers',
      face: 'wach',
      hat: null,
      beard: null,
      glasses: 'round',
    },
  },
  atelier: {
    name: 'Atelier · Feminin',
    character: {
      proportion: 'kompakt',
      hair: 'braids',
      hair_color: 'rot',
      beard_color: 'rot',
      top: 'dress_red',
      outfit: 'dress',
      face: 'wach',
      hat: null,
      beard: null,
      glasses: null,
    },
  },
  business: {
    name: 'Business · Maskulin',
    character: {
      proportion: 'kompakt_markant',
      hair: 'side_part',
      hair_color: 'braun',
      beard_color: 'braun',
      top: 'suit_navy',
      outfit: 'trousers',
      face: 'ruhig',
      hat: null,
      beard: 'stubble',
      glasses: null,
    },
  },
  weekend: {
    name: 'Freizeit · Maskulin',
    character: {
      proportion: 'kompakt_kraeftig',
      hair: 'messy',
      hair_color: 'blond',
      beard_color: 'blond',
      top: 'hoodie_blue',
      outfit: 'trousers',
      face: 'freundlich',
      hat: 'beanie',
      beard: 'trimmed',
      glasses: null,
    },
  },
  cap: {
    name: 'Mit Cap',
    character: {
      hair: 'side_part',
      hair_color: 'schwarz',
      beard_color: 'schwarz',
      top: 'suit_navy',
      outfit: 'trousers',
      hat: 'cap',
      beard: null,
      glasses: null,
    },
  },
  hood: {
    name: 'Mit Kapuze',
    character: {
      hair: 'bob',
      hair_color: 'grau',
      beard_color: 'grau',
      top: 'blazer_anthracite',
      outfit: 'trousers',
      hat: 'hood',
      beard: null,
      glasses: null,
    },
  },
  copper: {
    name: 'Kupferrote Zöpfe',
    character: {
      hair: 'braids',
      hair_color: 'rot',
      beard_color: 'rot',
      top: 'dress_red',
      outfit: 'dress',
      hat: null,
      beard: null,
      glasses: null,
    },
  },
};

export function parseCharacter(value: unknown): Character {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Im Rezept fehlt eine gültige Figur.');
  const fields = [...Object.keys(defaultCharacter), 'proportion'];
  const entries = Object.entries(value);
  if (entries.some(([key, v]) => !fields.includes(key) || (v !== null && typeof v !== 'string')))
    throw new Error('Die Figur enthält unbekannte Felder oder Werte.');
  const config = value as Character;
  if (
    'proportion' in config &&
    (typeof config.proportion !== 'string' || !Object.hasOwn(proportions, config.proportion))
  )
    throw new Error('Unbekannte Körperform im Charakterrezept.');
  const result = validateConfig(catalog, config);
  if (!result.ok || !Object.hasOwn(faceNames, config.face))
    throw new Error('Die Figur enthält eine ungültige Kombination.');
  return { ...defaultCharacter, ...config };
}

export const hairNames = {
  messy: 'Strubbelig',
  bob: 'Bob',
  buzz: 'Kurz',
  side_part: 'Seitenscheitel',
  curly: 'Locken',
  spiky: 'Stachelig',
  long: 'Lang',
  ponytail: 'Pferdeschwanz',
  bun: 'Dutt',
  braids: 'Zöpfe',
  bald: 'Ohne Haare',
};
export const skinColors = Object.fromEntries(
  Object.entries(catalogData.palettes.skin).map(([id, palette]) => [id, palette.b]),
);
export const hairColors = Object.fromEntries(
  Object.entries(catalogData.palettes.hair).map(([id, palette]) => [id, palette.i]),
);
