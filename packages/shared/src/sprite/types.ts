// Types for the sprite catalog (schema meetropolis-sprite-catalog/v5) and the
// isomorphic composer. The composer is a pure DATA interpreter of the catalog's
// `compose` block; it re-encodes NONE of the Python generator's rendering,
// outfit or pose logic, so the two implementations cannot drift.
//
// Provenance: catalog.json is AGPL-3.0 generator output (see
// packages/shared/sprite/NOTICE); these types describe it but add no data.

/** One RGBA colour, channels 0-255. */
export type Rgba = readonly [number, number, number, number];

/** A character grid: rows of `FW`-char strings; `'.'` is transparent. */
export type Grid = readonly string[];

/** A palette dict maps a single-char slot to a `#rrggbb` colour. */
export type PaletteDict = Readonly<Record<string, string>>;

/**
 * The 12-field editable avatar recipe. Optional fields may be null/absent. The
 * index signature makes this a dynamic bag: the composer reads fields by name
 * driven by the catalog's `palette_compose` / `config_fields`, so named-only
 * access is not enough. Values are always string | null | undefined.
 */
export interface AvatarConfig {
  skin: string;
  hair: string;
  hair_color: string;
  outfit: string;
  top?: string | null;
  pants?: string | null;
  shoes?: string | null;
  beard?: string | null;
  beard_color?: string | null;
  glasses?: string | null;
  hat?: string | null;
  misc?: string | null;
  [field: string]: string | null | undefined;
}

/** A summed dx/dy term: a choreography field name, or that field times a flag. */
export type LayoutTerm = string | { field: string; mul: 'hand_swing' };

/** One layer in a view: which kit slot, and how it shifts per walk frame. */
export interface PartLayoutEntry {
  slot: string;
  dx: LayoutTerm[];
  dy: LayoutTerm[];
}

export type View = 'front' | 'side' | 'rear';

/** A sheet state either renders a view+sequence, or mirrors another state. */
export interface StateSpec {
  view?: View;
  sequence?: string;
  mirror?: string;
}

export interface PaletteRef {
  ref?: string; // flat or keyed palette under catalog.palettes
  key?: string; // config field selecting the keyed palette
  catalog?: string; // accessory group under catalog.catalogs (.palette)
  when?: string; // config field gating an accessory palette
  skip_value?: string; // config value that skips this accessory palette
  derive?: { slot: string; ref: string; key: string; from_slot: string };
}

export interface PaletteCompose {
  base: PaletteRef[];
  per_mode: Record<string, PaletteRef[]>;
  accessories: PaletteRef[];
}

export interface OutfitSpec {
  hand_swing: boolean;
  slots: Record<string, string>;
}

export interface AccessorySpec {
  field: string;
  slots: Record<string, string>;
  hood_value?: string;
  hood_slots?: Record<string, string>;
}

export interface ConfigFieldSpec {
  required: boolean;
  values: string[];
  default?: string;
}

export interface HardRules {
  hood: {
    hat_value: string;
    replaces: string[];
    excludes_hats: boolean;
    requires_top_palette: boolean;
    invalid_with_outfits: string[];
  };
  required_per_mode: Record<string, string[]>;
  mirror_right_from_left: boolean;
}

/** The v5 machine-readable compose contract. */
export interface ComposeContract {
  hood_hat_value: string;
  base_kit: Record<string, string>;
  hair_slots: Record<string, string>;
  outfits: Record<string, OutfitSpec>;
  accessories: Record<string, AccessorySpec>;
  palette_compose: PaletteCompose;
  part_layout: Record<View, PartLayoutEntry[]>;
  fields: Record<View, string[]>;
  sequences: Record<string, number[][]>;
  states: Record<string, StateSpec>;
  sheet_placement: { idle_rows: string[]; walk_rows: string[] };
  config_fields: Record<string, ConfigFieldSpec>;
  hard_rules: HardRules;
}

export interface SheetFormat {
  frame_w: number;
  frame_h: number;
  cols: number;
  rows: number;
  sheet_w: number;
  sheet_h: number;
}

/**
 * The parts of the catalog the composer reads. `catalogs` is a deep, dynamic
 * grid tree navigated by dot-path, so it stays loosely typed (guarded at
 * runtime by `getGrid`); everything the interpreter drives off is precise.
 */
export interface SpriteCatalog {
  schema: string;
  format: SheetFormat;
  palettes: Record<string, PaletteDict | Record<string, PaletteDict>>;
  catalogs: Record<string, unknown>;
  compose: ComposeContract;
}

/** A composed RGBA image (row-major, 4 bytes/pixel). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export const CATALOG_SCHEMA_V5 = 'meetropolis-sprite-catalog/v5';
