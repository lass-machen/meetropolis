import { extraHatNames, extraBeardNames } from './avatar-accessories.ts';
export { extraHatNames, extraBeardNames };
import catalogData from '../../../packages/shared/sprite/catalog.json' with { type: 'json' };
import { proportions, type ProportionId } from './avatar-proportions.ts';
export { proportions, type ProportionId } from './avatar-proportions.ts';
import {
  assertSpriteCatalog,
  composeSheet,
  resolveSpriteCatalog,
  validateConfig,
  type AvatarConfig,
  type RgbaImage,
} from '../../../packages/shared/src/sprite/index.ts';
import { faceNames, type FaceId } from './avatar-catalog.ts';
export { faceNames, type FaceId } from './avatar-catalog.ts';
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
  proportion: 'kompakt',
};
const catalog = assertSpriteCatalog(structuredClone(catalogData));

export function characterSheet(config: Character): RgbaImage {
  return composeSheet(catalog, config);
}

export function hairColorsFor(config: Character): Record<string, string> {
  const palette = resolveSpriteCatalog(catalog, config).palettes.hair as Record<string, Record<string, string>>;
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
  const fields = Object.keys(defaultCharacter);
  const entries = Object.entries(value);
  if (entries.some(([key, v]) => !fields.includes(key) || (v !== null && typeof v !== 'string')))
    throw new Error('Die Figur enthält unbekannte Felder oder Werte.');
  const config = { ...defaultCharacter, ...(value as Partial<Character>) };
  if (typeof config.proportion !== 'string' || !Object.hasOwn(proportions, config.proportion))
    throw new Error('Unbekannte Körperform im Charakterrezept.');
  const result = validateConfig(catalog, config);
  if (!result.ok || !Object.hasOwn(faceNames, config.face))
    throw new Error('Die Figur enthält eine ungültige Kombination.');
  return config;
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
