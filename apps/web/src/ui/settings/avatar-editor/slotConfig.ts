// Editor slot metadata + config transitions, derived entirely from the catalog
// (config_fields + hard_rules + palette_compose), so the UI cannot drift from
// the server's authoritative rules. The composer/validator stay in the shared
// package; this only decides what to show and how a slot change reshapes config.

import type { AvatarConfig, SpriteCatalog } from '@meetropolis/shared';

export interface SlotGroup {
  field: string;
  labelKey: string;
}

// Display order. Accessory slots (beard/glasses/hat/misc) also offer a "none"
// choice (see offersNone); labels live in the shared i18n dictionaries.
export const SLOT_GROUPS: SlotGroup[] = [
  { field: 'skin', labelKey: 'avatarEditor.slot.skin' },
  { field: 'face', labelKey: 'avatarEditor.slot.face' },
  { field: 'hair', labelKey: 'avatarEditor.slot.hair' },
  { field: 'hair_color', labelKey: 'avatarEditor.slot.hairColor' },
  { field: 'outfit', labelKey: 'avatarEditor.slot.outfit' },
  { field: 'top', labelKey: 'avatarEditor.slot.top' },
  { field: 'pants', labelKey: 'avatarEditor.slot.pants' },
  { field: 'shoes', labelKey: 'avatarEditor.slot.shoes' },
  { field: 'beard', labelKey: 'avatarEditor.slot.beard' },
  { field: 'beard_color', labelKey: 'avatarEditor.slot.beardColor' },
  { field: 'glasses', labelKey: 'avatarEditor.slot.glasses' },
  { field: 'hat', labelKey: 'avatarEditor.slot.hat' },
  { field: 'misc', labelKey: 'avatarEditor.slot.misc' },
];

const ACCESSORY_FIELDS = new Set(['beard', 'glasses', 'hat', 'misc']);
const PALETTE_SLOT_FIELDS = new Set(['top', 'pants', 'shoes']);

export function offersNone(field: string): boolean {
  return ACCESSORY_FIELDS.has(field);
}

export function optionsForField(catalog: SpriteCatalog, field: string): string[] {
  return catalog.compose.config_fields[field]?.values ?? [];
}

function paletteFieldsForOutfit(catalog: SpriteCatalog, outfit: string): string[] {
  const perMode = catalog.compose.palette_compose.per_mode[outfit] ?? [];
  return perMode.map((ref) => ref.key).filter((key): key is string => key !== undefined);
}

/** Whether a slot group applies to the current config (else it is hidden). */
export function isApplicable(catalog: SpriteCatalog, config: AvatarConfig, field: string): boolean {
  if (PALETTE_SLOT_FIELDS.has(field)) {
    return paletteFieldsForOutfit(catalog, config.outfit).includes(field);
  }
  if (field === 'beard_color') return Boolean(config.beard);
  return true;
}

/** Whether a specific option value is currently selectable for a field. */
export function isOptionEnabled(catalog: SpriteCatalog, config: AvatarConfig, field: string, value: string): boolean {
  // The hood occupies the hat slot but needs a top palette, so it is invalid
  // with the base outfit (mirrors the shared validator's hood rule).
  if (field === 'hat' && value === catalog.compose.hood_hat_value) {
    return !catalog.compose.hard_rules.hood.invalid_with_outfits.includes(config.outfit);
  }
  return true;
}

/** Whether the hair slot is currently overridden (by the hood). */
export function isHairReplaced(catalog: SpriteCatalog, config: AvatarConfig): boolean {
  return config.hat === catalog.compose.hood_hat_value;
}

/** A valid starting config (first value per required field; trousers outfit). */
export function initialConfig(catalog: SpriteCatalog): AvatarConfig {
  const fields = catalog.compose.config_fields;
  const first = (f: string) => fields[f]?.values[0] ?? '';
  return {
    skin: first('skin'),
    hair: first('hair'),
    hair_color: first('hair_color'),
    outfit: fields.outfit?.default ?? first('outfit'),
    face: fields.face?.default ?? first('face'),
    proportion: fields.proportion?.default ?? first('proportion'),
    top: first('top'),
    pants: first('pants'),
    shoes: first('shoes'),
    beard_color: fields.beard_color?.default ?? first('beard_color'),
  };
}

/**
 * Apply a single slot change and repair invariants: clear the hood when it
 * becomes invalid (base outfit), and backfill any now-required palette field so
 * the config always stays renderable + valid.
 */
export function setField(
  catalog: SpriteCatalog,
  config: AvatarConfig,
  field: string,
  value: string | null,
): AvatarConfig {
  const next: AvatarConfig = { ...config, [field]: value };
  const hood = catalog.compose.hood_hat_value;
  if (
    field === 'outfit' &&
    next.hat === hood &&
    catalog.compose.hard_rules.hood.invalid_with_outfits.includes(String(value))
  ) {
    next.hat = null;
  }
  const fields = catalog.compose.config_fields;
  for (const f of PALETTE_SLOT_FIELDS) {
    if (isApplicable(catalog, next, f) && !next[f]) next[f] = fields[f]?.values[0] ?? null;
  }
  return next;
}

/** Prettify a raw catalog value for display (e.g. `side_part` -> `Side part`). */
export function prettyValue(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
