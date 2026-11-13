/**
 * Eingangsgrenzen für Kartenobjekt-Fußabdrücke (Q-WE/A26).
 *
 * Begrenzt nur neue Maß- und Skalier-Eingaben an den beiden POST-Einstiegs-
 * punkten (Einzel- und Bulk-Anlage). Bestandswelten, Seeds, automatische
 * Migrationen und Backfills laden und berechnen weiter ohne diese Grenzen;
 * `computeFootprintTiles` in collisionHelpers.ts bleibt unverändert.
 *
 * Rechenvertrag (exakt zum aktuellen Raster): Effektive Pixelmaße sind
 * `width * (scaleFactor ?? 1)` bzw. `height * (scaleFactor ?? 1)`; die
 * Kachelzahlen sind `ceil(effektive Breite / map.tileWidth)` und
 * `ceil(effektive Höhe / map.tileHeight)` mit den echten Map-Maßen aus
 * `getMapDimensions` (niemals fest verdrahtete 16). Die volle Fläche zählt
 * immer — auch bei `collide: false` und unabhängig von
 * `collisionBaseHeight`. Overflow, NaN, Infinity und unsichere Zahlen werden
 * abgelehnt; Produkt und Bulk-Summe sind vor Überlauf geschützt.
 */

export const MAX_OBJECT_FOOTPRINT_TILES = 4096;
export const MAX_BULK_FOOTPRINT_TILES = 65536;

export interface FootprintInput {
  width: number;
  height: number;
  scaleFactor?: number;
}

export interface MapTileDimensions {
  tileWidth: number;
  tileHeight: number;
}

export type FootprintLimitError =
  'invalid_map_dimensions' | 'invalid_object_dimensions' | 'object_footprint_too_large' | 'bulk_footprint_too_large';

export type FootprintCheck = { ok: true; tiles: number } | { ok: false; error: FootprintLimitError };

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function footprintTiles(input: FootprintInput, dims: MapTileDimensions): FootprintCheck {
  if (!positiveFinite(dims.tileWidth) || !positiveFinite(dims.tileHeight)) {
    return { ok: false, error: 'invalid_map_dimensions' };
  }
  if (!positiveFinite(input.width) || !positiveFinite(input.height)) {
    return { ok: false, error: 'invalid_object_dimensions' };
  }
  const scale = input.scaleFactor ?? 1;
  if (!positiveFinite(scale)) {
    return { ok: false, error: 'invalid_object_dimensions' };
  }
  const effWidth = input.width * scale;
  const effHeight = input.height * scale;
  if (!positiveFinite(effWidth) || !positiveFinite(effHeight)) {
    return { ok: false, error: 'invalid_object_dimensions' };
  }
  const tilesW = Math.ceil(effWidth / dims.tileWidth);
  const tilesH = Math.ceil(effHeight / dims.tileHeight);
  if (!Number.isSafeInteger(tilesW) || tilesW < 1 || !Number.isSafeInteger(tilesH) || tilesH < 1) {
    return { ok: false, error: 'invalid_object_dimensions' };
  }
  const tiles = tilesW * tilesH;
  if (!Number.isSafeInteger(tiles) || tiles < 1) {
    return { ok: false, error: 'invalid_object_dimensions' };
  }
  if (tiles > MAX_OBJECT_FOOTPRINT_TILES) {
    return { ok: false, error: 'object_footprint_too_large' };
  }
  return { ok: true, tiles };
}

/** Prüft ein einzelnes Objekt gegen die 4096-Kacheln-Grenze. */
export function checkSingleFootprint(input: FootprintInput, dims: MapTileDimensions): FootprintCheck {
  return footprintTiles(input, dims);
}

/**
 * Prüft die gesamte Bulk-Liste vor jeder Schreibung: Jedes Objekt muss die
 * Einzelgrenze einhalten und die Summe darf 65536 Kacheln nicht übersteigen.
 * Der Aufrufer darf bei `ok: false` nichts schreiben (keine Teilwrites).
 */
export function checkBulkFootprints(inputs: FootprintInput[], dims: MapTileDimensions): FootprintCheck {
  let total = 0;
  for (const input of inputs) {
    const single = footprintTiles(input, dims);
    if (!single.ok) return single;
    total += single.tiles;
    if (!Number.isSafeInteger(total) || total < 0) {
      return { ok: false, error: 'bulk_footprint_too_large' };
    }
    if (total > MAX_BULK_FOOTPRINT_TILES) {
      return { ok: false, error: 'bulk_footprint_too_large' };
    }
  }
  return { ok: true, tiles: total };
}
