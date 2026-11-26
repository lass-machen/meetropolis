// Style-study palette: every symbol used by the hand-set source grids.
// One warm outline, three coordinated values per material (light, base,
// shadow), no white, no dither slots. Skin base ramps for the four catalog
// tones match packages/shared/sprite/catalog.json; fair/olive/deep/deepest
// are the four extra row-only tones from the local preview build.ts.

export const SYMBOLS = [
  'O',
  'a',
  'b',
  'c',
  'h',
  'i',
  'j',
  't',
  'u',
  'v',
  'p',
  'q',
  'n',
  'r',
  's',
  'd',
  'E',
  'M',
] as const;

export type Symbol = (typeof SYMBOLS)[number];

const SYMBOL_SET = new Set<string>(SYMBOLS);

export function isSymbol(value: string): value is Symbol {
  return SYMBOL_SET.has(value);
}

// Soft silhouette line shared by all four figures: the effective kompakt
// outline (#403548) resolved from the unchanged catalog, not the base.
export const OUTLINE = '#403548';

// Face ink (2px-high dark eyes) and calm mouth: effective kompakt values.
// No white slot is provided on purpose: the study bans specular dots.
export const FACE_INK = '#352c43';
export const MOUTH = '#b36d69';

export interface SkinTone {
  tone: string;
  ramp: [string, string, string];
  isNew: boolean;
}

// Order follows the local preview SKIN_TONES (build.ts): the four catalog
// tones light/medium/tan/dark plus the four row-only tones fair/olive/deep/
// deepest, marked as new.
export const SKIN_TONES: SkinTone[] = [
  { tone: 'fair', ramp: ['#f9e4d6', '#efcdb9', '#d39f8a'], isNew: true },
  { tone: 'light', ramp: ['#ffdec5', '#fdcbb0', '#e09782'], isNew: false },
  { tone: 'medium', ramp: ['#efbfa6', '#dd9d80', '#b7705e'], isNew: false },
  { tone: 'olive', ramp: ['#d4a67c', '#b98a61', '#86603f'], isNew: true },
  { tone: 'tan', ramp: ['#dfa088', '#bd7051', '#8e4a3b'], isNew: false },
  { tone: 'dark', ramp: ['#9e6a54', '#885c47', '#5a3a2e'], isNew: false },
  { tone: 'deep', ramp: ['#7f5441', '#6b4535', '#47291f'], isNew: true },
  { tone: 'deepest', ramp: ['#6b4636', '#5a3a2d', '#40281f'], isNew: true },
];

export interface HairRamp {
  color: string;
  ramp: [string, string, string];
}

// Effective kompakt hair ramps from resolveSpriteCatalog (unchanged
// catalog): the kompakt overlays replace the base hair colors, so the
// study reuses these to match the real before-state recipe colors.
export const HAIR_RAMPS: HairRamp[] = [
  { color: 'braun', ramp: ['#b87d58', '#84584a', '#573d43'] },
  { color: 'rot', ramp: ['#f6b164', '#dd7950', '#a7474b'] },
  { color: 'schwarz', ramp: ['#71778c', '#4c526b', '#35364f'] },
];

// Effective kompakt hoodie_blue from resolveSpriteCatalog (unchanged
// catalog): the calm grey-blue the product actually renders.
export const TOP_HOODIE_BLUE: [string, string, string] = ['#91b6c4', '#5e829f', '#485974'];

// Catalog pants dark has two values; the study adds one darker step (n) so
// trousers also carry three coordinated values. Documented study extension.
export const PANTS_DARK: [string, string, string] = ['#3f3f4a', '#28282f', '#1d1d23'];

// Catalog shoes brown. Slot r is the brightest step and is used as the
// light; s is the mid step, d the dark sole.
export const SHOES_BROWN: { light: string; mid: string; dark: string } = {
  light: '#a06849',
  mid: '#6b3a26',
  dark: '#3f2417',
};

export interface FigurePalette {
  O: string;
  a: string;
  b: string;
  c: string;
  h: string;
  i: string;
  j: string;
  t: string;
  u: string;
  v: string;
  p: string;
  q: string;
  n: string;
  r: string;
  s: string;
  d: string;
  E: string;
  M: string;
}

export function figurePalette(skin: string, hairColor: string): FigurePalette {
  const tone = SKIN_TONES.find((entry) => entry.tone === skin);
  if (!tone) throw new Error(`unknown skin tone: ${skin}`);
  const hair = HAIR_RAMPS.find((entry) => entry.color === hairColor);
  if (!hair) throw new Error(`unknown hair color: ${hairColor}`);
  return {
    O: OUTLINE,
    a: tone.ramp[0],
    b: tone.ramp[1],
    c: tone.ramp[2],
    h: hair.ramp[0],
    i: hair.ramp[1],
    j: hair.ramp[2],
    t: TOP_HOODIE_BLUE[0],
    u: TOP_HOODIE_BLUE[1],
    v: TOP_HOODIE_BLUE[2],
    p: PANTS_DARK[0],
    q: PANTS_DARK[1],
    n: PANTS_DARK[2],
    r: SHOES_BROWN.light,
    s: SHOES_BROWN.mid,
    d: SHOES_BROWN.dark,
    E: FACE_INK,
    M: MOUTH,
  };
}
