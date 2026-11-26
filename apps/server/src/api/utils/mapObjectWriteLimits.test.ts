/**
 * Boundaries of the shared write-path footprint guard.
 *
 * POST already rejects oversized objects up front; every other write path
 * (PATCH, paint, TMJ import) funnels through `assertObjectFootprints` and
 * answers 400 via `sendFootprintError` instead of 500. Tile size is 16 px,
 * so 1024 x 1024 px is exactly the 4096-tile limit and must pass, while
 * 1040 x 1024 px (4160 tiles) must fail.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  assertObjectFootprints,
  footprintErrorBody,
  mapTileDimensions,
  sendFootprintError,
  MapObjectFootprintRejectedError,
} from './mapObjectWriteLimits.js';
import { ObjectFootprintLimitError } from './objectFootprintLimits.js';

const DIMS_16 = { tileWidth: 16, tileHeight: 16 };

describe('assertObjectFootprints', () => {
  it('allows exactly 4096 tiles (1024 x 1024 px on 16 px tiles)', () => {
    expect(() => assertObjectFootprints([{ width: 1024, height: 1024 }], DIMS_16)).not.toThrow();
  });

  it('rejects 4160 tiles (1040 x 1024 px) with object_footprint_too_large', () => {
    try {
      assertObjectFootprints([{ width: 1040, height: 1024 }], DIMS_16);
      expect.unreachable('must throw for 4160 tiles');
    } catch (error) {
      expect(error).toBeInstanceOf(MapObjectFootprintRejectedError);
      expect((error as MapObjectFootprintRejectedError).code).toBe('object_footprint_too_large');
    }
  });

  it('rejects width 0 with invalid_object_dimensions', () => {
    try {
      assertObjectFootprints([{ width: 0, height: 1024 }], DIMS_16);
      expect.unreachable('must throw for width 0');
    } catch (error) {
      expect(error).toBeInstanceOf(MapObjectFootprintRejectedError);
      expect((error as MapObjectFootprintRejectedError).code).toBe('invalid_object_dimensions');
    }
  });

  it('rejects scaleFactor 2.5 on 512 x 512 px (80 x 80 = 6400 tiles)', () => {
    try {
      assertObjectFootprints([{ width: 512, height: 512, scaleFactor: 2.5 }], DIMS_16);
      expect.unreachable('must throw for scaled 6400 tiles');
    } catch (error) {
      expect(error).toBeInstanceOf(MapObjectFootprintRejectedError);
      expect((error as MapObjectFootprintRejectedError).code).toBe('object_footprint_too_large');
    }
  });
});

describe('footprintErrorBody', () => {
  it('maps MapObjectFootprintRejectedError to its code', () => {
    expect(footprintErrorBody(new MapObjectFootprintRejectedError('object_footprint_too_large'))).toEqual({
      error: 'object_footprint_too_large',
    });
  });

  it('maps ObjectFootprintLimitError to object_footprint_too_large', () => {
    expect(footprintErrorBody(new ObjectFootprintLimitError())).toEqual({ error: 'object_footprint_too_large' });
  });

  it('returns null for an unrelated error', () => {
    expect(footprintErrorBody(new Error('boom'))).toBeNull();
  });
});

describe('sendFootprintError', () => {
  it('answers 400 with the body for a footprint failure', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Parameters<typeof sendFootprintError>[0];
    const handled = sendFootprintError(res, new MapObjectFootprintRejectedError('object_footprint_too_large'));
    expect(handled).toBe(true);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'object_footprint_too_large' });
  });

  it('returns false and touches res for an unrelated error', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Parameters<typeof sendFootprintError>[0];
    const handled = sendFootprintError(res, new Error('boom'));
    expect(handled).toBe(false);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});

describe('mapTileDimensions', () => {
  it('falls back to 16 px for null tile sizes', () => {
    expect(mapTileDimensions({ tileWidth: null, tileHeight: null })).toEqual({ tileWidth: 16, tileHeight: 16 });
  });
});
