import { describe, expect, it } from 'vitest';
import {
  TmjSchema,
  buildGidToSlotMapping,
  gidToTileRefId,
  tileRefIdToGid,
  computeFirstGidsFromTileCounts,
  matchTmjLayerToV2,
  flatGidsToTileRefIds,
  chunkAndEncode,
  decodeChunksToFlat,
  extractZonesFromObjectLayers,
  extractSpawnFromObjectLayers,
  buildTmjFromV2,
} from './tmjService.js';
import { tileRefIdFrom } from '../mapEncoding.js';

// ---------------------------------------------------------------------------
// gidToTileRefId + tileRefIdToGid round-trip
// ---------------------------------------------------------------------------

describe('gidToTileRefId + tileRefIdToGid round-trip', () => {
  const slotAssignments = [
    { firstgid: 1, slot: 0 },
    { firstgid: 257, slot: 1 },
  ];
  const { firstGids, toSlot } = buildGidToSlotMapping(slotAssignments);

  it('converts GID from first tileset and back', () => {
    // GID 1 → slot 0, tileIndex 0
    const ref = gidToTileRefId(1, firstGids, toSlot);
    expect(ref).toBe(tileRefIdFrom(0, 0));

    const firstGidsExport = computeFirstGidsFromTileCounts([
      { slot: 0, tileCount: 256 },
      { slot: 1, tileCount: 512 },
    ]);
    expect(tileRefIdToGid(ref, firstGidsExport)).toBe(1);
  });

  it('converts GID from second tileset and back', () => {
    // GID 260 → slot 1, tileIndex 3
    const ref = gidToTileRefId(260, firstGids, toSlot);
    expect(ref).toBe(tileRefIdFrom(1, 3));

    const firstGidsExport = computeFirstGidsFromTileCounts([
      { slot: 0, tileCount: 256 },
      { slot: 1, tileCount: 512 },
    ]);
    expect(tileRefIdToGid(ref, firstGidsExport)).toBe(260);
  });

  it('returns 0 for GID 0 or negative', () => {
    expect(gidToTileRefId(0, firstGids, toSlot)).toBe(0);
    expect(gidToTileRefId(-1, firstGids, toSlot)).toBe(0);
  });

  it('returns 0 for tileRefId 0', () => {
    expect(tileRefIdToGid(0, [1, 257])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeFirstGidsFromTileCounts
// ---------------------------------------------------------------------------

describe('computeFirstGidsFromTileCounts', () => {
  it('computes sorted first GIDs', () => {
    const result = computeFirstGidsFromTileCounts([
      { slot: 0, tileCount: 100 },
      { slot: 1, tileCount: 200 },
      { slot: 2, tileCount: 50 },
    ]);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(101);
    expect(result[2]).toBe(301);
  });

  it('uses 1024 fallback for null tileCount', () => {
    const result = computeFirstGidsFromTileCounts([
      { slot: 0, tileCount: null },
      { slot: 1, tileCount: 10 },
    ]);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(1025);
  });

  it('handles unsorted slots', () => {
    const result = computeFirstGidsFromTileCounts([
      { slot: 2, tileCount: 50 },
      { slot: 0, tileCount: 100 },
    ]);
    expect(result[0]).toBe(1);
    expect(result[2]).toBe(101);
  });
});

// ---------------------------------------------------------------------------
// matchTmjLayerToV2
// ---------------------------------------------------------------------------

describe('matchTmjLayerToV2', () => {
  it('matches "Ground" layer', () => {
    expect(matchTmjLayerToV2('Ground')).toEqual({ v2Name: 'ground', encoding: 'rle' });
  });

  it('matches "ground_tiles" (case-insensitive)', () => {
    expect(matchTmjLayerToV2('ground_tiles')).toEqual({ v2Name: 'ground', encoding: 'rle' });
  });

  it('matches "Walls" layer', () => {
    expect(matchTmjLayerToV2('Walls')).toEqual({ v2Name: 'walls', encoding: 'rle' });
  });

  it('matches "wall_layer" (case-insensitive)', () => {
    expect(matchTmjLayerToV2('wall_layer')).toEqual({ v2Name: 'walls', encoding: 'rle' });
  });

  it('matches "Collision" layer', () => {
    expect(matchTmjLayerToV2('Collision')).toEqual({ v2Name: 'collision', encoding: 'rle-bool' });
  });

  it('matches "collision_map" (case-insensitive)', () => {
    expect(matchTmjLayerToV2('COLLISION_MAP')).toEqual({ v2Name: 'collision', encoding: 'rle-bool' });
  });

  it('returns null for unknown layers', () => {
    expect(matchTmjLayerToV2('Decor')).toBeNull();
    expect(matchTmjLayerToV2('Objects')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// chunkAndEncode + decodeChunksToFlat round-trip
// ---------------------------------------------------------------------------

describe('chunkAndEncode + decodeChunksToFlat round-trip', () => {
  it('encodes and decodes a 4x4 map with chunkSize=2 (rle)', () => {
    // 4x4 map, each tile has a tileRefId
    const tileRefs = [
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      13, 14, 15, 16,
    ];

    const chunks = chunkAndEncode(tileRefs, 4, 4, 2, 'rle');
    expect(chunks.length).toBe(4); // 2x2 chunks

    const decoded = decodeChunksToFlat(
      chunks.map(c => ({ x: c.cx, y: c.cy, encoding: c.encoding, data: c.data })),
      4, 4, 2
    );
    expect(decoded).toEqual(tileRefs);
  });

  it('encodes and decodes a 4x4 map with chunkSize=2 (rle-bool)', () => {
    const tileRefs = [
      1, 0, 1, 0,
      0, 1, 0, 1,
      1, 1, 0, 0,
      0, 0, 1, 1,
    ];

    const chunks = chunkAndEncode(tileRefs, 4, 4, 2, 'rle-bool');
    expect(chunks.length).toBe(4);

    const decoded = decodeChunksToFlat(
      chunks.map(c => ({ x: c.cx, y: c.cy, encoding: c.encoding, data: c.data })),
      4, 4, 2
    );
    expect(decoded).toEqual(tileRefs);
  });

  it('handles non-aligned map size (3x3 with chunkSize=2)', () => {
    const tileRefs = [
      1, 2, 3,
      4, 5, 6,
      7, 8, 9,
    ];

    const chunks = chunkAndEncode(tileRefs, 3, 3, 2, 'rle');
    expect(chunks.length).toBe(4); // 2x2 chunks (ceil(3/2) = 2)

    const decoded = decodeChunksToFlat(
      chunks.map(c => ({ x: c.cx, y: c.cy, encoding: c.encoding, data: c.data })),
      3, 3, 2
    );
    expect(decoded).toEqual(tileRefs);
  });
});

// ---------------------------------------------------------------------------
// extractZonesFromObjectLayers
// ---------------------------------------------------------------------------

describe('extractZonesFromObjectLayers', () => {
  it('extracts rectangle as polygon', () => {
    const layers = [{
      name: 'objects',
      type: 'objectgroup',
      objects: [{
        name: 'Meeting Room',
        type: 'zone',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      }],
    }];

    const zones = extractZonesFromObjectLayers(layers);
    expect(zones).toHaveLength(1);
    expect(zones[0].name).toBe('Meeting Room');
    expect(zones[0].polygon).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ]);
  });

  it('extracts polygon directly', () => {
    const layers = [{
      name: 'objects',
      type: 'objectgroup',
      objects: [{
        name: 'Custom Zone',
        type: 'zone',
        x: 5,
        y: 10,
        polygon: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 30 },
        ],
      }],
    }];

    const zones = extractZonesFromObjectLayers(layers);
    expect(zones).toHaveLength(1);
    expect(zones[0].polygon).toEqual([
      { x: 5, y: 10 },
      { x: 55, y: 10 },
      { x: 55, y: 40 },
    ]);
  });

  it('filters out spawn objects', () => {
    const layers = [{
      name: 'objects',
      type: 'objectgroup',
      objects: [
        { name: 'spawn', type: 'spawn', x: 0, y: 0, width: 10, height: 10 },
        { name: 'Lounge', type: 'zone', x: 50, y: 50, width: 100, height: 100 },
      ],
    }];

    const zones = extractZonesFromObjectLayers(layers);
    expect(zones).toHaveLength(1);
    expect(zones[0].name).toBe('Lounge');
  });

  it('extracts capacity from properties', () => {
    const layers = [{
      name: 'objects',
      type: 'objectgroup',
      objects: [{
        name: 'Small Room',
        type: 'zone',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        properties: [{ name: 'capacity', value: 5 }],
      }],
    }];

    const zones = extractZonesFromObjectLayers(layers);
    expect(zones[0].capacity).toBe(5);
  });

  it('returns null capacity when no property', () => {
    const layers = [{
      name: 'objects',
      type: 'objectgroup',
      objects: [{
        name: 'Open Area',
        type: 'zone',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }],
    }];

    const zones = extractZonesFromObjectLayers(layers);
    expect(zones[0].capacity).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractSpawnFromObjectLayers
// ---------------------------------------------------------------------------

describe('extractSpawnFromObjectLayers', () => {
  it('finds spawn by type', () => {
    const layers = [{
      name: 'objects',
      type: 'objectgroup',
      objects: [
        { name: 'player_start', type: 'spawn', x: 100, y: 200 },
      ],
    }];

    const spawn = extractSpawnFromObjectLayers(layers);
    expect(spawn).toEqual({ x: 100, y: 200 });
  });

  it('finds spawn by name', () => {
    const layers = [{
      name: 'objects',
      type: 'objectgroup',
      objects: [
        { name: 'Spawn', type: '', x: 50, y: 75 },
      ],
    }];

    const spawn = extractSpawnFromObjectLayers(layers);
    expect(spawn).toEqual({ x: 50, y: 75 });
  });

  it('returns null when no spawn', () => {
    const layers = [{
      name: 'objects',
      type: 'objectgroup',
      objects: [
        { name: 'Zone1', type: 'zone', x: 0, y: 0 },
      ],
    }];

    const spawn = extractSpawnFromObjectLayers(layers);
    expect(spawn).toBeNull();
  });

  it('returns null for empty layers', () => {
    expect(extractSpawnFromObjectLayers([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildTmjFromV2
// ---------------------------------------------------------------------------

describe('buildTmjFromV2', () => {
  it('produces valid TMJ structure', () => {
    const result = buildTmjFromV2({
      mapWidth: 4,
      mapHeight: 4,
      tileWidth: 32,
      tileHeight: 32,
      tilesets: [
        {
          slot: 0,
          key: 'terrain',
          imageUrl: '/terrain.png',
          tileWidth: 32,
          tileHeight: 32,
          tileCount: 100,
        },
      ],
      layers: [],
    });

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(result.tilewidth).toBe(32);
    expect(result.tileheight).toBe(32);
    expect(result.tilesets).toHaveLength(1);
    expect(result.tilesets[0].firstgid).toBe(1);
    expect(result.tilesets[0].name).toBe('terrain');
  });

  it('includes zones and spawn in output', () => {
    const result = buildTmjFromV2({
      mapWidth: 4,
      mapHeight: 4,
      tileWidth: 32,
      tileHeight: 32,
      tilesets: [],
      layers: [],
      zones: [
        {
          name: 'Lobby',
          capacity: 10,
          polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        },
      ],
      spawn: { x: 50, y: 50 },
    });

    const objLayer = result.layers.find(l => l.type === 'objectgroup');
    expect(objLayer).toBeDefined();
    expect(objLayer!.objects).toHaveLength(2); // zone + spawn
    expect(objLayer!.objects![1].name).toBe('spawn');
    expect(objLayer!.objects![1].x).toBe(50);
  });

  it('produces valid TMJ according to schema', () => {
    const result = buildTmjFromV2({
      mapWidth: 2,
      mapHeight: 2,
      tileWidth: 16,
      tileHeight: 16,
      tilesets: [
        {
          slot: 0,
          key: 'tiles',
          imageUrl: '/tiles.png',
          tileWidth: 16,
          tileHeight: 16,
          tileCount: 64,
        },
      ],
      layers: [],
    });

    const parsed = TmjSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TmjSchema validation
// ---------------------------------------------------------------------------

describe('TmjSchema', () => {
  it('validates a valid TMJ object', () => {
    const valid = {
      width: 10,
      height: 10,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [{
        firstgid: 1,
        name: 'terrain',
        image: 'terrain.png',
        tilewidth: 32,
        tileheight: 32,
      }],
      layers: [{
        name: 'ground',
        type: 'tilelayer',
        data: [1, 2, 3],
        width: 10,
        height: 10,
      }],
    };

    const result = TmjSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects missing width', () => {
    const invalid = {
      height: 10,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [],
      layers: [],
    };

    const result = TmjSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects negative tilewidth', () => {
    const invalid = {
      width: 10,
      height: 10,
      tilewidth: -1,
      tileheight: 32,
      tilesets: [],
      layers: [],
    };

    const result = TmjSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// flatGidsToTileRefIds
// ---------------------------------------------------------------------------

describe('flatGidsToTileRefIds', () => {
  const slotAssignments = [
    { firstgid: 1, slot: 0 },
    { firstgid: 101, slot: 1 },
  ];
  const { firstGids, toSlot } = buildGidToSlotMapping(slotAssignments);

  it('converts GIDs in rle mode', () => {
    const data = [0, 1, 5, 101, 105];
    const result = flatGidsToTileRefIds(data, 'rle', firstGids, toSlot);
    expect(result[0]).toBe(0); // empty
    expect(result[1]).toBe(tileRefIdFrom(0, 0)); // GID 1 → slot 0, index 0
    expect(result[2]).toBe(tileRefIdFrom(0, 4)); // GID 5 → slot 0, index 4
    expect(result[3]).toBe(tileRefIdFrom(1, 0)); // GID 101 → slot 1, index 0
    expect(result[4]).toBe(tileRefIdFrom(1, 4)); // GID 105 → slot 1, index 4
  });

  it('converts GIDs in rle-bool mode (gid>0 → 1)', () => {
    const data = [0, 5, 0, 101, 0];
    const result = flatGidsToTileRefIds(data, 'rle-bool', firstGids, toSlot);
    expect(result).toEqual([0, 1, 0, 1, 0]);
  });
});
