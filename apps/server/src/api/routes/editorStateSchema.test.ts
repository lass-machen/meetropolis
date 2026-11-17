import { describe, expect, it } from 'vitest';
import { editorStateSchema } from './editorStateSchema.js';
import { dndSchema, moveSchema } from '../../rooms/validation/worldPayloadSchemas.js';

interface TilesetSample {
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
}

interface PointSample {
  x: number;
  y: number;
}

function tilesets(count: number): TilesetSample[] {
  const list: TilesetSample[] = [];
  for (let index = 0; index < count; index += 1) {
    list.push({ key: `sheet-${index}`, dataUrl: 'x', tileWidth: 1, tileHeight: 1 });
  }
  return list;
}

function zones(count: number): Array<{ name: string; points: PointSample[] }> {
  const shape = polygon(3);
  const list: Array<{ name: string; points: PointSample[] }> = [];
  for (let index = 0; index < count; index += 1) list.push({ name: `area-${index}`, points: shape });
  return list;
}

function polygon(count: number): PointSample[] {
  const list: PointSample[] = [];
  for (let index = 0; index < count; index += 1) list.push({ x: index, y: 0 });
  return list;
}

describe('editor state schema', () => {
  it('accepts 256 tilesets', () => {
    expect(editorStateSchema.safeParse({ tilesets: tilesets(256) }).success).toBe(true);
  });

  it('rejects 257 tilesets', () => {
    expect(editorStateSchema.safeParse({ tilesets: tilesets(257) }).success).toBe(false);
  });

  it('accepts 512 zones', () => {
    expect(editorStateSchema.safeParse({ zones: zones(512) }).success).toBe(true);
  });

  it('rejects 513 zones', () => {
    expect(editorStateSchema.safeParse({ zones: zones(513) }).success).toBe(false);
  });

  it('accepts a polygon of 3 points', () => {
    const body = { zones: [{ name: 'Gate', points: polygon(3) }] };
    expect(editorStateSchema.safeParse(body).success).toBe(true);
  });

  it('accepts a polygon of 2048 points', () => {
    const body = { zones: [{ name: 'Gate', points: polygon(2048) }] };
    expect(editorStateSchema.safeParse(body).success).toBe(true);
  });

  it('rejects a polygon of 2 points', () => {
    const body = { zones: [{ name: 'Gate', points: polygon(2) }] };
    expect(editorStateSchema.safeParse(body).success).toBe(false);
  });

  it('rejects a polygon of 2049 points', () => {
    const body = { zones: [{ name: 'Gate', points: polygon(2049) }] };
    expect(editorStateSchema.safeParse(body).success).toBe(false);
  });

  it('accepts a capacity of 10000', () => {
    const body = { zones: [{ name: 'Hall', capacity: 10000, points: polygon(3) }] };
    expect(editorStateSchema.safeParse(body).success).toBe(true);
  });

  it('rejects a capacity of 10001', () => {
    const body = { zones: [{ name: 'Hall', capacity: 10001, points: polygon(3) }] };
    expect(editorStateSchema.safeParse(body).success).toBe(false);
  });

  it('accepts a zone name of 256 characters', () => {
    const body = { zones: [{ name: 'n'.repeat(256), points: polygon(3) }] };
    expect(editorStateSchema.safeParse(body).success).toBe(true);
  });

  it('rejects a zone name of 257 characters', () => {
    const body = { zones: [{ name: 'n'.repeat(257), points: polygon(3) }] };
    expect(editorStateSchema.safeParse(body).success).toBe(false);
  });

  it('accepts spawn null to remove the spawn', () => {
    expect(editorStateSchema.safeParse({ spawn: null }).success).toBe(true);
  });

  it('keeps a zone id and a null capacity and drops an unknown key', () => {
    const parsed = editorStateSchema.safeParse({
      zones: [
        {
          id: 'zone-1',
          name: 'Round',
          capacity: null,
          polygon: polygon(3),
          type: 'default',
          portalTarget: null,
          portalSpawnX: null,
          portalSpawnY: null,
          legacyFlag: true,
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const zone = parsed.data.zones?.[0];
    expect(zone?.id).toBe('zone-1');
    expect(zone?.capacity).toBeNull();
    expect(zone).not.toHaveProperty('legacyFlag');
  });
});

describe('move schema', () => {
  it('rejects a coordinate sent as text', () => {
    expect(moveSchema.safeParse({ x: '1', y: 0, direction: 'up' }).success).toBe(false);
  });

  it('rejects a coordinate that is not a number', () => {
    expect(moveSchema.safeParse({ x: Number.NaN, y: 0, direction: 'up' }).success).toBe(false);
  });

  it('rejects an infinite coordinate', () => {
    expect(moveSchema.safeParse({ x: Number.POSITIVE_INFINITY, y: 0, direction: 'up' }).success).toBe(false);
  });

  it('rejects an unknown direction', () => {
    expect(moveSchema.safeParse({ x: 1, y: 0, direction: 'north' }).success).toBe(false);
  });
});

describe('dnd schema', () => {
  it('rejects a do-not-disturb flag sent as text', () => {
    expect(dndSchema.safeParse({ dnd: 'true' }).success).toBe(false);
  });
});
