// Data-driven config validation + canonicalization. Every rule here is derived
// from the catalog's `config_fields` and `hard_rules`, so it cannot drift from
// the Python generator's KeyError / ValueError branches. Kept dependency-free
// (no zod) so @meetropolis/shared stays runtime-dep-free and isomorphic; the
// server wraps this as the authoritative check, the editor reuses it live.

import { configValue } from './palette.js';
import type { AvatarConfig, SpriteCatalog } from './types.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Optional palette-driven fields (top/pants/shoes) actually used per outfit. */
function paletteFieldsForOutfit(catalog: SpriteCatalog, outfit: string): string[] {
  const perMode = catalog.compose.palette_compose.per_mode[outfit];
  if (perMode === undefined) return [];
  return perMode.map((ref) => ref.key).filter((key): key is string => key !== undefined);
}

/** Validate a config against the catalog. Returns all violations found. */
export function validateConfig(catalog: SpriteCatalog, config: AvatarConfig): ValidationResult {
  const compose = catalog.compose;
  const errors: string[] = [];

  // 1. Every provided value must be a known catalog value; base-required fields
  //    must be present.
  for (const [field, spec] of Object.entries(compose.config_fields)) {
    const value = configValue(config, field);
    if (value === null) {
      if (spec.required) errors.push(`missing required field: ${field}`);
      continue;
    }
    if (!spec.values.includes(value)) errors.push(`invalid ${field}: ${value}`);
  }

  const outfit = configValue(config, 'outfit') ?? compose.config_fields.outfit.default ?? '';
  const validOutfit = compose.outfits[outfit] !== undefined;
  if (!validOutfit) return { ok: false, errors };

  // 2. Per-mode required fields (e.g. trousers needs top/pants/shoes).
  for (const field of compose.hard_rules.required_per_mode[outfit] ?? []) {
    if (configValue(config, field) === null) errors.push(`outfit '${outfit}' requires ${field}`);
  }

  // 3. Hood rule: it replaces hair, needs a top palette -> invalid with base.
  const hood = compose.hard_rules.hood;
  if (configValue(config, 'hat') === hood.hat_value && hood.invalid_with_outfits.includes(outfit)) {
    errors.push(`hood is not valid with outfit '${outfit}'`);
  }

  // A beard colour without a beard is ignored (never an error); catalog value
  // validity is already covered in step 1.
  return { ok: errors.length === 0, errors };
}

/** Kit slots whose grid path is selected by a config field (`{hair}` -> `hair`). */
function slotsDrivenBy(mapping: Record<string, string>, field: string): string[] {
  const token = `{${field}}`;
  return Object.entries(mapping)
    .filter(([, gridPath]) => gridPath.includes(token))
    .map(([slot]) => slot);
}

/**
 * True when the hood covers every kit slot the `hair` field selects, which makes
 * the hair STYLE invisible. Derived from `hard_rules.hood.replaces` rather than
 * hardcoded: a future hair slot the hood does not cover keeps the style
 * significant automatically.
 *
 * `hair_color` is deliberately NOT covered by this: it also feeds the derived
 * brow slot (`palette_compose.base`), which the hood does not replace, so it
 * stays visible — and stays part of the identity — under the hood.
 */
function hoodHidesHairStyle(catalog: SpriteCatalog, config: AvatarConfig): boolean {
  const { hood } = catalog.compose.hard_rules;
  if (configValue(config, 'hat') !== hood.hat_value) return false;
  const hairSlots = slotsDrivenBy(catalog.compose.hair_slots, 'hair');
  return hairSlots.length > 0 && hairSlots.every((slot) => hood.replaces.includes(slot));
}

/**
 * Canonicalize a (validated) config: apply defaults and drop fields that do not
 * affect the rendered sheet for the chosen outfit (e.g. pants under a dress) or
 * for the chosen accessories (e.g. the hair style under a hood).
 * The result is the identity anchor for hashing/dedup — two configs that render
 * identically canonicalize identically.
 *
 * Hidden-but-required fields are normalized to a catalog-VALID stand-in rather
 * than dropped: `hair` is required and its slots are always resolved, so an
 * absent or synthetic value would make the canonical config unrenderable and
 * fail validation. Under a hood every hair value renders identically, so any
 * valid one is a faithful anchor.
 */
export function canonicalConfig(catalog: SpriteCatalog, config: AvatarConfig): AvatarConfig {
  const compose = catalog.compose;
  const outfit = configValue(config, 'outfit') ?? compose.config_fields.outfit.default ?? 'trousers';
  const usedPaletteFields = new Set(paletteFieldsForOutfit(catalog, outfit));
  const hairField = compose.config_fields.hair;
  const hair = hoodHidesHairStyle(catalog, config)
    ? (hairField.default ?? hairField.values[0] ?? '')
    : (configValue(config, 'hair') ?? '');

  const out: AvatarConfig = {
    skin: configValue(config, 'skin') ?? '',
    hair,
    hair_color: configValue(config, 'hair_color') ?? '',
    outfit,
  };

  for (const field of ['top', 'pants', 'shoes'] as const) {
    if (usedPaletteFields.has(field)) {
      const value = configValue(config, field);
      if (value !== null) out[field] = value;
    }
  }

  const beard = configValue(config, 'beard');
  if (beard !== null) {
    out.beard = beard;
    out.beard_color = configValue(config, 'beard_color') ?? compose.config_fields.beard_color.default ?? 'braun';
  }
  for (const field of ['glasses', 'hat', 'misc'] as const) {
    const value = configValue(config, field);
    if (value !== null) out[field] = value;
  }

  return out;
}

/** Stable, sorted-key JSON of the canonical config — the dedup/hash anchor. */
export function canonicalConfigString(catalog: SpriteCatalog, config: AvatarConfig): string {
  const canonical = canonicalConfig(catalog, config);
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(canonical).sort()) {
    const value = canonical[key];
    if (typeof value === 'string') sorted[key] = value;
  }
  return JSON.stringify(sorted);
}
