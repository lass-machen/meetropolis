export const MAX_OBJECT_FOOTPRINT_TILES = 4096;

export class ObjectFootprintLimitError extends Error {
  constructor(message = 'Object footprint exceeds the maximum allowed tile count') {
    super(message);
    this.name = 'ObjectFootprintLimitError';
  }
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ObjectFootprintLimitError(`${label} must be a finite positive number`);
  }
}

export function computeFootprintTileDimensions(
  widthPx: number,
  heightPx: number,
  tileWidth: number,
  tileHeight: number,
): { tilesW: number; tilesH: number; tileCount: number } {
  assertFinitePositive(widthPx, 'widthPx');
  assertFinitePositive(heightPx, 'heightPx');
  assertFinitePositive(tileWidth, 'tileWidth');
  assertFinitePositive(tileHeight, 'tileHeight');

  const tilesW = Math.ceil(widthPx / tileWidth);
  const tilesH = Math.ceil(heightPx / tileHeight);

  if (!Number.isSafeInteger(tilesW) || tilesW <= 0) {
    throw new ObjectFootprintLimitError('computed tile width is not a safe positive integer');
  }
  if (!Number.isSafeInteger(tilesH) || tilesH <= 0) {
    throw new ObjectFootprintLimitError('computed tile height is not a safe positive integer');
  }

  const tileCount = tilesW * tilesH;
  if (!Number.isSafeInteger(tileCount) || tileCount <= 0) {
    throw new ObjectFootprintLimitError('computed tile count is not a safe positive integer');
  }
  if (tileCount > MAX_OBJECT_FOOTPRINT_TILES) {
    throw new ObjectFootprintLimitError(
      `object footprint ${tileCount} tiles exceeds maximum ${MAX_OBJECT_FOOTPRINT_TILES}`,
    );
  }

  return { tilesW, tilesH, tileCount };
}
