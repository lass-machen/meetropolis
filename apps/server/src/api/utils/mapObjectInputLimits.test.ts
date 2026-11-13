/**
 * Reine Grenzfälle für die Eingangsgrenzen (Q-WE/A26): exakte 4096/4097,
 * exakte 65536/Überschreitung, Skalierung mit Pixel-Ceil-Rändern, Scale-
 * Overflow und ungültige Map-Kachelmaße. Dazu ein Legacy-Kompatibilitäts-
 * fall: Die bewährte Berechnungsfunktion liefert weiterhin 4097 Kacheln für
 * große Bestandseingaben — sie bleibt ohne globale Begrenzung, damit alte
 * Welten, Seeds und Migrationen unverändert laden.
 */
import { describe, it, expect } from 'vitest';
import {
  checkBulkFootprints,
  checkSingleFootprint,
  MAX_BULK_FOOTPRINT_TILES,
  MAX_OBJECT_FOOTPRINT_TILES,
} from './mapObjectInputLimits.js';
import { computeFootprintTiles } from './collisionHelpers.js';

const DIMS = { tileWidth: 16, tileHeight: 16 };

describe('checkSingleFootprint', () => {
  it('nimmt exakt 4096 Kacheln an (64 x 64 bei 16-px-Kacheln)', () => {
    expect(checkSingleFootprint({ width: 1024, height: 1024, scaleFactor: 1 }, DIMS)).toEqual({
      ok: true,
      tiles: 4096,
    });
    expect(MAX_OBJECT_FOOTPRINT_TILES).toBe(4096);
  });

  it('lehnt 4097 Kacheln mit stabilem Fehlercode ab', () => {
    expect(checkSingleFootprint({ width: 16 * 4097, height: 16, scaleFactor: 1 }, DIMS)).toEqual({
      ok: false,
      error: 'object_footprint_too_large',
    });
  });

  it('skaliert vor dem Aufrunden auf Kacheln (Ceil-Ränder)', () => {
    // 17 px -> 2 Kacheln je Achse, also 4 Kacheln.
    expect(checkSingleFootprint({ width: 17, height: 17 }, DIMS)).toEqual({ ok: true, tiles: 4 });
    // Maßstab 1,5 auf 16 px -> 24 px effektiv -> 2 x 2 Kacheln.
    expect(checkSingleFootprint({ width: 16, height: 16, scaleFactor: 1.5 }, DIMS)).toEqual({
      ok: true,
      tiles: 4,
    });
  });

  it('lehnt einen Scale-Overflow ohne Absturz ab', () => {
    expect(checkSingleFootprint({ width: 32, height: 32, scaleFactor: 1e308 }, DIMS)).toEqual({
      ok: false,
      error: 'invalid_object_dimensions',
    });
  });

  it('lehnt ungültige Map-Kachelmaße mit eigenem Fehlercode ab', () => {
    expect(checkSingleFootprint({ width: 16, height: 16 }, { tileWidth: 0, tileHeight: 16 })).toEqual({
      ok: false,
      error: 'invalid_map_dimensions',
    });
    expect(checkSingleFootprint({ width: 16, height: 16 }, { tileWidth: Number.NaN, tileHeight: 16 })).toEqual({
      ok: false,
      error: 'invalid_map_dimensions',
    });
  });
});

describe('checkBulkFootprints', () => {
  it('nimmt exakt 65536 Summen-Kacheln an (64 Objekte a 1024 Kacheln)', () => {
    const objects = Array.from({ length: 64 }, () => ({ width: 512, height: 512, scaleFactor: 1 }));
    expect(checkBulkFootprints(objects, DIMS)).toEqual({ ok: true, tiles: 65536 });
    expect(MAX_BULK_FOOTPRINT_TILES).toBe(65536);
  });

  it('lehnt eine überschrittene Summe mit stabilem Fehlercode ab', () => {
    const objects = Array.from({ length: 65 }, () => ({ width: 512, height: 512, scaleFactor: 1 }));
    expect(checkBulkFootprints(objects, DIMS)).toEqual({
      ok: false,
      error: 'bulk_footprint_too_large',
    });
  });

  it('meldet ein einzeln zu großes Objekt auch bei kleiner Summe', () => {
    const objects = [
      { width: 16, height: 16 },
      { width: 16 * 4097, height: 16, scaleFactor: 1 },
    ];
    expect(checkBulkFootprints(objects, DIMS)).toEqual({
      ok: false,
      error: 'object_footprint_too_large',
    });
  });
});

describe('computeFootprintTiles bleibt unbegrenzt (Legacy-Kompatibilität)', () => {
  it('liefert weiterhin 4097 Kacheln für große Bestandseingaben', () => {
    const tiles = computeFootprintTiles(0, 0, 16 * 4097, 16, 16, 16, 32, 0);
    expect(tiles).toHaveLength(4097);
  });
});
