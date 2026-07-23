// Sheet assembly: turns an AvatarConfig into the spec 128x256 sheet by
// interpreting the catalog's compose contract. This is a pure DATA interpreter
// of generate.resolve (kit), poses (part layout + choreography) and
// engine.compose_sheet (sheet placement) — no rendering logic is duplicated.

import { blitGrid, makeFrame, mirrorFrame } from './frame.js';
import { buildPalette, configValue } from './palette.js';
import type { AvatarConfig, Grid, LayoutTerm, Rgba, RgbaImage, SpriteCatalog, View } from './types.js';

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value) && value.every((row) => typeof row === 'string');
}

/** Resolve a dot-path (with `{field}` substitutions) into a catalog grid. */
export function getGrid(catalog: SpriteCatalog, path: string, config: AvatarConfig): Grid {
  const segments = path.split('.').map((seg) => {
    const match = seg.match(/^\{(.+)\}$/);
    if (!match) return seg;
    const value = configValue(config, match[1]);
    if (value === null) throw new Error(`path ${path} needs config.${match[1]}`);
    return value;
  });
  let node: unknown = catalog.catalogs;
  for (const seg of segments) {
    if (typeof node !== 'object' || node === null) throw new Error(`bad grid path: ${path}`);
    node = (node as Record<string, unknown>)[seg];
  }
  if (!isGrid(node)) throw new Error(`grid path did not resolve to a grid: ${path}`);
  return node;
}

interface Kit {
  slots: Map<string, Grid>;
  handSwing: boolean;
}

/** Assemble the flat slot -> grid kit for a config (mirrors generate.resolve). */
function resolveKit(catalog: SpriteCatalog, config: AvatarConfig): Kit {
  const compose = catalog.compose;
  const slots = new Map<string, Grid>();
  const setAll = (mapping: Record<string, string>): void => {
    for (const [slot, path] of Object.entries(mapping)) slots.set(slot, getGrid(catalog, path, config));
  };

  setAll(compose.base_kit);
  setAll(compose.hair_slots);

  const outfit = compose.outfits[config.outfit];
  if (outfit === undefined) throw new Error(`unknown outfit: ${config.outfit}`);
  setAll(outfit.slots);

  for (const spec of Object.values(compose.accessories)) {
    const value = configValue(config, spec.field);
    if (value === null) continue;
    if (spec.hood_value !== undefined && value === spec.hood_value) {
      if (spec.hood_slots !== undefined) setAll(spec.hood_slots);
      continue;
    }
    setAll(spec.slots);
  }

  return { slots, handSwing: outfit.hand_swing };
}

function evalTerms(terms: LayoutTerm[], fields: Map<string, number>, handSwing: boolean): number {
  let total = 0;
  for (const term of terms) {
    if (typeof term === 'string') {
      total += fields.get(term) ?? 0;
    } else if (term.mul === 'hand_swing') {
      total += (fields.get(term.field) ?? 0) * (handSwing ? 1 : 0);
    }
  }
  return total;
}

/** Render one 32x32 frame for a view under a choreography vector. */
function renderFrame(
  catalog: SpriteCatalog,
  kit: Kit,
  palette: ReadonlyMap<string, Rgba>,
  view: View,
  vector: number[],
): Uint8ClampedArray {
  const { frame_w: fw, frame_h: fh } = catalog.format;
  const fieldNames = catalog.compose.fields[view];
  const fields = new Map<string, number>();
  fieldNames.forEach((name, i) => fields.set(name, vector[i] ?? 0));

  const frame = makeFrame(fw, fh);
  for (const entry of catalog.compose.part_layout[view]) {
    const grid = kit.slots.get(entry.slot);
    if (grid === undefined) continue;
    const dx = evalTerms(entry.dx, fields, kit.handSwing);
    const dy = evalTerms(entry.dy, fields, kit.handSwing);
    blitGrid(frame, fw, fh, grid, dx, dy, palette);
  }
  return frame;
}

/** Render the frame list for every sheet state (mirrors resolve into left). */
function renderStates(
  catalog: SpriteCatalog,
  kit: Kit,
  palette: ReadonlyMap<string, Rgba>,
): Map<string, Uint8ClampedArray[]> {
  const { frame_w: fw, frame_h: fh } = catalog.format;
  const states = catalog.compose.states;
  const out = new Map<string, Uint8ClampedArray[]>();

  for (const [name, spec] of Object.entries(states)) {
    if (spec.mirror !== undefined) continue;
    if (spec.view === undefined || spec.sequence === undefined) {
      throw new Error(`state ${name} needs view + sequence`);
    }
    const sequence = catalog.compose.sequences[spec.sequence];
    if (sequence === undefined) throw new Error(`unknown sequence: ${spec.sequence}`);
    out.set(
      name,
      sequence.map((vector) => renderFrame(catalog, kit, palette, spec.view as View, vector)),
    );
  }

  for (const [name, spec] of Object.entries(states)) {
    if (spec.mirror === undefined) continue;
    const source = out.get(spec.mirror);
    if (source === undefined) throw new Error(`mirror source not rendered: ${spec.mirror}`);
    out.set(
      name,
      source.map((frame) => mirrorFrame(frame, fw, fh)),
    );
  }

  return out;
}

function placeFrame(
  sheet: Uint8ClampedArray,
  sheetW: number,
  frame: Uint8ClampedArray,
  fw: number,
  fh: number,
  ox: number,
  oy: number,
): void {
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const src = (y * fw + x) * 4;
      const dst = ((oy + y) * sheetW + (ox + x)) * 4;
      sheet[dst] = frame[src];
      sheet[dst + 1] = frame[src + 1];
      sheet[dst + 2] = frame[src + 2];
      sheet[dst + 3] = frame[src + 3];
    }
  }
}

/**
 * Compose the full 128x256 RGBA sheet for a config. Idle frames land on rows
 * 0-3 (column 0), walk frames on rows 4-7 (columns 0-3), matching
 * engine.compose_sheet and the fixed sheet contract old clients depend on.
 */
export function composeSheet(catalog: SpriteCatalog, config: AvatarConfig): RgbaImage {
  const { frame_w: fw, frame_h: fh, sheet_w: sheetW, sheet_h: sheetH } = catalog.format;
  const kit = resolveKit(catalog, config);
  const palette = buildPalette(catalog, config);
  const states = renderStates(catalog, kit, palette);
  const { idle_rows: idleRows, walk_rows: walkRows } = catalog.compose.sheet_placement;

  const sheet = makeFrame(sheetW, sheetH);
  idleRows.forEach((state, row) => {
    const frames = states.get(state);
    if (frames === undefined || frames[0] === undefined) throw new Error(`missing idle state: ${state}`);
    placeFrame(sheet, sheetW, frames[0], fw, fh, 0, row * fh);
  });
  walkRows.forEach((state, row) => {
    const frames = states.get(state);
    if (frames === undefined) throw new Error(`missing walk state: ${state}`);
    frames.forEach((frame, col) => placeFrame(sheet, sheetW, frame, fw, fh, col * fw, (4 + row) * fh));
  });

  return { width: sheetW, height: sheetH, data: sheet };
}
