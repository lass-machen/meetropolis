/**
 * EditorValidation: pure validation helpers for editor operations.
 *
 * Principles:
 * - Explicit error messages (no swallowed failures).
 * - Pure functions, no try/catch indirection.
 */

import { Zone } from './EditorService';

export class EditorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditorValidationError';
  }
}

/** Return true if two axis-aligned rectangles overlap. */
function rectsOverlap(
  rect1: { x0: number; y0: number; x1: number; y1: number },
  rect2: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  return !(rect1.x1 <= rect2.x0 || rect1.x0 >= rect2.x1 || rect1.y1 <= rect2.y0 || rect1.y0 >= rect2.y1);
}

/** Convert zone points to a bounding rectangle, or null if invalid. */
function zoneToRect(zone: Zone): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!zone.points || zone.points.length < 4) {
    return null;
  }

  const xs = zone.points.map((p) => p.x);
  const ys = zone.points.map((p) => p.y);

  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

/**
 * Validate that a new zone does not overlap any existing zone.
 *
 * @throws EditorValidationError when an overlap is detected.
 */
export function validateZoneNoOverlap(newZone: Zone, existingZones: Zone[], excludeIndex?: number): void {
  const newRect = zoneToRect(newZone);
  if (!newRect) {
    throw new EditorValidationError('Ungültige Zone: Mindestens 4 Punkte erforderlich');
  }

  for (let i = 0; i < existingZones.length; i++) {
    if (excludeIndex !== undefined && i === excludeIndex) {
      continue;
    }

    const existingZone = existingZones[i];
    const existingRect = zoneToRect(existingZone);

    if (existingRect && rectsOverlap(newRect, existingRect)) {
      throw new EditorValidationError(`Zone überlappt mit existierender Zone "${existingZone.name}"`);
    }
  }
}

/**
 * Validate that a zone name is well formed.
 *
 * @throws EditorValidationError when the name is empty or too long.
 */
export function validateZoneName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new EditorValidationError('Zone-Name darf nicht leer sein');
  }

  if (name.length > 100) {
    throw new EditorValidationError('Zone-Name ist zu lang (max. 100 Zeichen)');
  }
}

/**
 * Validate that a zone meets the minimum tile size.
 *
 * @throws EditorValidationError when the zone is below the minimum size.
 */
export function validateZoneSize(
  startTileX: number,
  startTileY: number,
  endTileX: number,
  endTileY: number,
  minTiles: number = 1,
): void {
  const width = Math.abs(endTileX - startTileX) + 1;
  const height = Math.abs(endTileY - startTileY) + 1;

  if (width < minTiles || height < minTiles) {
    throw new EditorValidationError(`Zone ist zu klein (min. ${minTiles}x${minTiles} Tiles)`);
  }
}

/**
 * Validate that an asset can be placed at the given tile position.
 *
 * @throws EditorValidationError when the position is outside the map.
 */
export function validateAssetPlacement(tileX: number, tileY: number, mapWidth: number, mapHeight: number): void {
  if (tileX < 0 || tileX >= mapWidth) {
    throw new EditorValidationError(`Asset-Position außerhalb der Map (X: ${tileX}, Map-Breite: ${mapWidth})`);
  }

  if (tileY < 0 || tileY >= mapHeight) {
    throw new EditorValidationError(`Asset-Position außerhalb der Map (Y: ${tileY}, Map-Höhe: ${mapHeight})`);
  }
}

/**
 * Validate that a tileset definition is well formed.
 *
 * @throws EditorValidationError when key, data URL, or dimensions are invalid.
 */
export function validateTileset(tileset: {
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
}): void {
  if (!tileset.key || tileset.key.trim().length === 0) {
    throw new EditorValidationError('Tileset-Key darf nicht leer sein');
  }

  if (!tileset.dataUrl || tileset.dataUrl.length === 0) {
    throw new EditorValidationError('Tileset-DataURL fehlt');
  }

  if (tileset.tileWidth <= 0 || tileset.tileHeight <= 0) {
    throw new EditorValidationError('Tileset-Dimensionen müssen positiv sein');
  }

  if (tileset.tileWidth > 256 || tileset.tileHeight > 256) {
    throw new EditorValidationError('Tileset-Dimensionen zu groß (max. 256x256)');
  }
}

/**
 * Validate that a spawn point lies inside the map bounds.
 *
 * @throws EditorValidationError when the spawn is outside the map.
 */
export function validateSpawn(tileX: number, tileY: number, mapWidth: number, mapHeight: number): void {
  if (tileX < 0 || tileX >= mapWidth) {
    throw new EditorValidationError(`Spawn außerhalb der Map (X: ${tileX}, Map-Breite: ${mapWidth})`);
  }

  if (tileY < 0 || tileY >= mapHeight) {
    throw new EditorValidationError(`Spawn außerhalb der Map (Y: ${tileY}, Map-Höhe: ${mapHeight})`);
  }
}

/**
 * Validate a hexadecimal RGB background color string.
 *
 * @throws EditorValidationError when the color is not in #RRGGBB format.
 */
export function validateBackgroundColor(color: string): void {
  const hexPattern = /^#[0-9A-Fa-f]{6}$/;
  if (!hexPattern.test(color)) {
    throw new EditorValidationError(`Ungültige Hintergrundfarbe: ${color} (Format: #RRGGBB)`);
  }
}
