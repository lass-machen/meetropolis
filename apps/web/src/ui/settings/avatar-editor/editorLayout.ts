// Presentation decisions for the editor: which slots sit in which category tab,
// which slots read as colour rather than as a garment, and the colour ramp a
// swatch shows. slotConfig.ts stays the catalog-truth layer (what is applicable
// and how a change reshapes the config); this module only decides how it looks.
//
// German labels are inlined for now (the rest of the editor is too); see the
// i18n follow-up before translating.

import { hexToRgba, type AvatarConfig, type PaletteDict, type SpriteCatalog } from '@meetropolis/shared';
import { SLOT_GROUPS, isApplicable, type SlotGroup } from './slotConfig';

export interface EditorTab {
  key: string;
  label: string;
  fields: string[];
}

export const EDITOR_TABS: EditorTab[] = [
  { key: 'body', label: 'Körper', fields: ['skin', 'hair', 'hair_color'] },
  { key: 'clothing', label: 'Kleidung', fields: ['outfit', 'top', 'pants', 'shoes'] },
  { key: 'extras', label: 'Extras', fields: ['beard', 'beard_color', 'glasses', 'hat', 'misc'] },
];

// Slots the user picks as a colour. `top` is palette-driven too, but its values
// are garments (shirt_white, hoodie_blue, suit_navy…) that people choose by the
// look of the item, so it renders as a sprite tile instead.
const COLOR_FIELDS = new Set(['skin', 'hair_color', 'beard_color', 'pants', 'shoes']);

/** Whether a slot is picked by colour (swatch tile) or by item (sprite tile). */
export function isColorField(field: string): boolean {
  return COLOR_FIELDS.has(field);
}

/** The applicable slot groups of one tab, in SLOT_GROUPS display order. */
export function groupsForTab(catalog: SpriteCatalog, config: AvatarConfig, tabKey: string): SlotGroup[] {
  const tab = EDITOR_TABS.find((t) => t.key === tabKey);
  if (tab === undefined) return [];
  return SLOT_GROUPS.filter((g) => tab.fields.includes(g.field) && isApplicable(catalog, config, g.field));
}

/**
 * The catalog palette a colour field selects, found through palette_compose so
 * the mapping cannot drift from the composer (skin -> palettes.skin,
 * hair_color -> palettes.hair, beard_color -> palettes.beard, …). Accessory
 * refs that carry their palette inside `catalogs` are not keyed palettes and
 * are skipped.
 */
function paletteRefName(catalog: SpriteCatalog, field: string): string | null {
  const compose = catalog.compose.palette_compose;
  const refs = [...compose.base, ...Object.values(compose.per_mode).flat(), ...compose.accessories];
  for (const ref of refs) {
    if (ref.key === field && ref.ref !== undefined && ref.catalog === undefined) return ref.ref;
  }
  return null;
}

/** Perceived brightness, for ordering a ramp light -> dark. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgba(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The colour ramp behind one option of a colour field, brightest first — the
 * real palette the sprite is painted with (highlight, mid, shadow), not a
 * single guessed swatch colour. Empty when the field is not palette-keyed or
 * the value is unknown; the caller then falls back to a neutral tile.
 */
export function paletteRampFor(catalog: SpriteCatalog, field: string, value: string): string[] {
  const refName = paletteRefName(catalog, field);
  if (refName === null) return [];
  const group = catalog.palettes[refName];
  if (group === undefined) return [];
  const entry = (group as Record<string, unknown>)[value];
  if (typeof entry !== 'object' || entry === null) return [];
  const hexes = Object.values(entry as PaletteDict).filter((hex) => typeof hex === 'string');
  return hexes.sort((a, b) => luminance(b) - luminance(a));
}
