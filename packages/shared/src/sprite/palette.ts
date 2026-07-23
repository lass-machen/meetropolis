// Palette assembly: mirrors engine.parse_palette + generate.resolve's palette
// list. Palettes are merged in catalog order and later entries win on slot
// collisions (so the derived brow slot R tracks hair, etc.).

import type { AvatarConfig, PaletteDict, PaletteRef, Rgba, SpriteCatalog } from './types.js';

/** Read a config field dynamically; empty string / missing counts as unset. */
export function configValue(config: AvatarConfig, field: string): string | null {
  const value = config[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Parse `#rrggbb` (leading `#` optional) into an opaque RGBA tuple. */
export function hexToRgba(hex: string): Rgba {
  const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  if (h.length !== 6) throw new Error(`invalid hex colour: ${hex}`);
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    throw new Error(`invalid hex colour: ${hex}`);
  }
  return [r, g, b, 255];
}

function isPaletteDict(value: unknown): value is PaletteDict {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).every((v) => typeof v === 'string');
}

function paletteDictAt(value: unknown, context: string): PaletteDict {
  if (!isPaletteDict(value)) throw new Error(`expected palette dict at ${context}`);
  return value;
}

/** Resolve a flat (`skin`) or keyed (`skin[light]`) palette by ref + key. */
function resolveRefPalette(catalog: SpriteCatalog, ref: PaletteRef, config: AvatarConfig): PaletteDict {
  const refName = ref.ref;
  if (refName === undefined) throw new Error('palette ref missing "ref"');
  const group = catalog.palettes[refName];
  if (group === undefined) throw new Error(`unknown palette ref: ${refName}`);
  if (ref.key === undefined) return paletteDictAt(group, `palettes.${refName}`);
  const keyValue = configValue(config, ref.key);
  if (keyValue === null) throw new Error(`palette ref ${refName} needs config.${ref.key}`);
  const keyed = group as Record<string, unknown>;
  return paletteDictAt(keyed[keyValue], `palettes.${refName}.${keyValue}`);
}

/** Resolve an accessory palette embedded in a catalog group (`glasses[rect].palette`). */
function resolveCatalogPalette(catalog: SpriteCatalog, group: string, value: string): PaletteDict {
  const entry = (catalog.catalogs[group] as Record<string, unknown> | undefined)?.[value];
  if (entry === undefined || typeof entry !== 'object' || entry === null) {
    throw new Error(`unknown catalog entry: ${group}.${value}`);
  }
  return paletteDictAt((entry as Record<string, unknown>).palette, `catalogs.${group}.${value}.palette`);
}

function mergeDict(into: Map<string, Rgba>, dict: PaletteDict): void {
  for (const [slot, hex] of Object.entries(dict)) into.set(slot, hexToRgba(hex));
}

function applyRef(catalog: SpriteCatalog, config: AvatarConfig, ref: PaletteRef, into: Map<string, Rgba>): void {
  if (ref.derive) {
    const source = resolveRefPalette(catalog, { ref: ref.derive.ref, key: ref.derive.key }, config);
    const hex = source[ref.derive.from_slot];
    if (hex === undefined) throw new Error(`derive source slot ${ref.derive.from_slot} missing`);
    into.set(ref.derive.slot, hexToRgba(hex));
    return;
  }
  if (ref.catalog !== undefined) {
    // Accessory palette, gated by its `when` config field.
    const gate = ref.when !== undefined ? configValue(config, ref.when) : null;
    if (gate === null || gate === ref.skip_value) return;
    const value = configValue(config, ref.key ?? ref.when ?? '');
    if (value === null) return;
    mergeDict(into, resolveCatalogPalette(catalog, ref.catalog, value));
    return;
  }
  if (ref.when !== undefined) {
    // Gated keyed palette (e.g. beard colour only when a beard is worn).
    if (configValue(config, ref.when) === null) return;
    mergeDict(into, resolveRefPalette(catalog, ref, config));
    return;
  }
  mergeDict(into, resolveRefPalette(catalog, ref, config));
}

/** Build the merged slot -> RGBA palette for a character config. */
export function buildPalette(catalog: SpriteCatalog, config: AvatarConfig): Map<string, Rgba> {
  const compose = catalog.compose.palette_compose;
  const palette = new Map<string, Rgba>();
  for (const ref of compose.base) applyRef(catalog, config, ref, palette);
  const perMode = compose.per_mode[config.outfit];
  if (perMode === undefined) throw new Error(`unknown outfit: ${config.outfit}`);
  for (const ref of perMode) applyRef(catalog, config, ref, palette);
  for (const ref of compose.accessories) applyRef(catalog, config, ref, palette);
  return palette;
}
