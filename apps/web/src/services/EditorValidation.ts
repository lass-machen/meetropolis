/**
 * EditorValidation - Validierungslogik für Editor-Operationen
 * 
 * Prinzipien:
 * - Explizite Fehler-Messages
 * - Keine Try-Catch
 * - Pure Functions
 */

import { Zone } from './EditorService';

export class EditorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditorValidationError';
  }
}

/**
 * Prüft ob zwei Rechtecke sich überlappen
 */
function rectsOverlap(
  rect1: { x0: number; y0: number; x1: number; y1: number },
  rect2: { x0: number; y0: number; x1: number; y1: number }
): boolean {
  return !(
    rect1.x1 <= rect2.x0 ||
    rect1.x0 >= rect2.x1 ||
    rect1.y1 <= rect2.y0 ||
    rect1.y0 >= rect2.y1
  );
}

/**
 * Konvertiert Zone-Points zu Rechteck
 */
function zoneToRect(zone: Zone): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!zone.points || zone.points.length < 4) {
    return null;
  }

  const xs = zone.points.map(p => p.x);
  const ys = zone.points.map(p => p.y);

  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

/**
 * Validiert ob eine neue Zone mit existierenden Zonen überlappt
 * 
 * @throws EditorValidationError wenn Überlappung gefunden wird
 */
export function validateZoneNoOverlap(
  newZone: Zone,
  existingZones: Zone[],
  excludeIndex?: number
): void {
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
      throw new EditorValidationError(
        `Zone überlappt mit existierender Zone "${existingZone.name}"`
      );
    }
  }
}

/**
 * Validiert ob ein Zone-Name gültig ist
 * 
 * @throws EditorValidationError wenn Name ungültig ist
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
 * Validiert ob eine Zone mindestens eine Mindestgröße hat
 * 
 * @throws EditorValidationError wenn Zone zu klein ist
 */
export function validateZoneSize(
  startTileX: number,
  startTileY: number,
  endTileX: number,
  endTileY: number,
  minTiles: number = 1
): void {
  const width = Math.abs(endTileX - startTileX) + 1;
  const height = Math.abs(endTileY - startTileY) + 1;

  if (width < minTiles || height < minTiles) {
    throw new EditorValidationError(
      `Zone ist zu klein (min. ${minTiles}x${minTiles} Tiles)`
    );
  }
}

/**
 * Validiert ob ein Asset an einer Position platziert werden kann
 * 
 * @throws EditorValidationError wenn Position ungültig ist
 */
export function validateAssetPlacement(
  tileX: number,
  tileY: number,
  mapWidth: number,
  mapHeight: number
): void {
  if (tileX < 0 || tileX >= mapWidth) {
    throw new EditorValidationError(
      `Asset-Position außerhalb der Map (X: ${tileX}, Map-Breite: ${mapWidth})`
    );
  }

  if (tileY < 0 || tileY >= mapHeight) {
    throw new EditorValidationError(
      `Asset-Position außerhalb der Map (Y: ${tileY}, Map-Höhe: ${mapHeight})`
    );
  }
}

/**
 * Validiert ob ein Tileset gültig ist
 * 
 * @throws EditorValidationError wenn Tileset ungültig ist
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
    throw new EditorValidationError(
      'Tileset-Dimensionen müssen positiv sein'
    );
  }

  if (tileset.tileWidth > 256 || tileset.tileHeight > 256) {
    throw new EditorValidationError(
      'Tileset-Dimensionen zu groß (max. 256x256)'
    );
  }
}

/**
 * Validiert ob ein Spawn-Punkt gültig ist
 * 
 * @throws EditorValidationError wenn Spawn ungültig ist
 */
export function validateSpawn(
  tileX: number,
  tileY: number,
  mapWidth: number,
  mapHeight: number
): void {
  if (tileX < 0 || tileX >= mapWidth) {
    throw new EditorValidationError(
      `Spawn außerhalb der Map (X: ${tileX}, Map-Breite: ${mapWidth})`
    );
  }

  if (tileY < 0 || tileY >= mapHeight) {
    throw new EditorValidationError(
      `Spawn außerhalb der Map (Y: ${tileY}, Map-Höhe: ${mapHeight})`
    );
  }
}

/**
 * Validiert ob Hintergrundfarbe gültig ist
 * 
 * @throws EditorValidationError wenn Farbe ungültig ist
 */
export function validateBackgroundColor(color: string): void {
  const hexPattern = /^#[0-9A-Fa-f]{6}$/;
  if (!hexPattern.test(color)) {
    throw new EditorValidationError(
      `Ungültige Hintergrundfarbe: ${color} (Format: #RRGGBB)`
    );
  }
}

