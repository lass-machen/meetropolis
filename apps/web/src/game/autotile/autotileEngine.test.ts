/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { computeBitmask4, bitmaskToFrame, getAffectedTiles } from './autotileEngine';
import { AutotileGrid } from './AutotileGrid';

describe('computeBitmask4', () => {
  it('returns 0 for isolated tile', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(0);
  });

  it('returns 1 for north neighbor', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(5, 4, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(1);
  });

  it('returns 2 for east neighbor', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(6, 5, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(2);
  });

  it('returns 4 for south neighbor', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(5, 6, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(4);
  });

  it('returns 8 for west neighbor', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(4, 5, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(8);
  });

  it('returns 5 for N+S (vertical straight)', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(5, 4, 1);
    grid.set(5, 6, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(5);
  });

  it('returns 10 for E+W (horizontal straight)', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(6, 5, 1);
    grid.set(4, 5, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(10);
  });

  it('returns 15 for all neighbors (cross)', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(5, 4, 1);
    grid.set(6, 5, 1);
    grid.set(5, 6, 1);
    grid.set(4, 5, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(15);
  });

  it('returns 3 for N+E corner', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(5, 4, 1);
    grid.set(6, 5, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(3);
  });

  it('returns 6 for S+E corner', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(5, 6, 1);
    grid.set(6, 5, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(6);
  });

  it('returns 9 for N+W corner', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(5, 4, 1);
    grid.set(4, 5, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(9);
  });

  it('returns 12 for S+W corner', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(5, 6, 1);
    grid.set(4, 5, 1);
    expect(computeBitmask4(grid, 5, 5)).toBe(12);
  });

  it.each([
    [0, []],
    [1, [[0, -1]]],
    [2, [[1, 0]]],
    [
      3,
      [
        [0, -1],
        [1, 0],
      ],
    ],
    [4, [[0, 1]]],
    [
      5,
      [
        [0, -1],
        [0, 1],
      ],
    ],
    [
      6,
      [
        [1, 0],
        [0, 1],
      ],
    ],
    [
      7,
      [
        [0, -1],
        [1, 0],
        [0, 1],
      ],
    ],
    [8, [[-1, 0]]],
    [
      9,
      [
        [0, -1],
        [-1, 0],
      ],
    ],
    [
      10,
      [
        [1, 0],
        [-1, 0],
      ],
    ],
    [
      11,
      [
        [0, -1],
        [1, 0],
        [-1, 0],
      ],
    ],
    [
      12,
      [
        [0, 1],
        [-1, 0],
      ],
    ],
    [
      13,
      [
        [0, -1],
        [0, 1],
        [-1, 0],
      ],
    ],
    [
      14,
      [
        [1, 0],
        [0, 1],
        [-1, 0],
      ],
    ],
    [
      15,
      [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ],
    ],
  ] as [number, number[][]][])('bitmask %i with neighbors %j', (expected, neighbors) => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    for (const [dx, dy] of neighbors) {
      grid.set(5 + dx, 5 + dy, 1);
    }
    expect(computeBitmask4(grid, 5, 5)).toBe(expected);
  });

  it('returns 0 for empty position', () => {
    const grid = new AutotileGrid();
    expect(computeBitmask4(grid, 5, 5)).toBe(0);
  });

  it('respects explicit wallTypeId override', () => {
    const grid = new AutotileGrid();
    grid.set(5, 4, 1);
    grid.set(6, 5, 1);
    // Position (5,5) is empty but we force wallTypeId=1
    expect(computeBitmask4(grid, 5, 5, 1)).toBe(3);
  });

  it('returns 0 when wallTypeId override is 0', () => {
    const grid = new AutotileGrid();
    grid.set(5, 5, 1);
    grid.set(5, 4, 1);
    expect(computeBitmask4(grid, 5, 5, 0)).toBe(0);
  });
});

describe('bitmaskToFrame', () => {
  const variants = {
    '0': { col: 0, row: 0 },
    '5': { col: 5, row: 0 },
    '15': { col: 7, row: 1 },
  };

  it('maps known bitmask', () => {
    expect(bitmaskToFrame(0, variants)).toEqual({ col: 0, row: 0 });
    expect(bitmaskToFrame(5, variants)).toEqual({ col: 5, row: 0 });
    expect(bitmaskToFrame(15, variants)).toEqual({ col: 7, row: 1 });
  });

  it('returns null for unknown bitmask', () => {
    expect(bitmaskToFrame(3, variants)).toBeNull();
  });

  it('returns null for empty variant map', () => {
    expect(bitmaskToFrame(0, {})).toBeNull();
  });
});

describe('getAffectedTiles', () => {
  it('returns center + 4 cardinal neighbors', () => {
    const tiles = getAffectedTiles(5, 5);
    expect(tiles).toHaveLength(5);
    expect(tiles).toContainEqual({ x: 5, y: 5 });
    expect(tiles).toContainEqual({ x: 5, y: 4 });
    expect(tiles).toContainEqual({ x: 6, y: 5 });
    expect(tiles).toContainEqual({ x: 5, y: 6 });
    expect(tiles).toContainEqual({ x: 4, y: 5 });
  });

  it('works at origin', () => {
    const tiles = getAffectedTiles(0, 0);
    expect(tiles).toHaveLength(5);
    expect(tiles).toContainEqual({ x: 0, y: 0 });
    expect(tiles).toContainEqual({ x: 0, y: -1 });
    expect(tiles).toContainEqual({ x: 1, y: 0 });
    expect(tiles).toContainEqual({ x: 0, y: 1 });
    expect(tiles).toContainEqual({ x: -1, y: 0 });
  });
});

describe('AutotileGrid', () => {
  it('get returns 0 for empty position', () => {
    const grid = new AutotileGrid();
    expect(grid.get(0, 0)).toBe(0);
  });

  it('set and get work correctly', () => {
    const grid = new AutotileGrid();
    grid.set(3, 4, 42);
    expect(grid.get(3, 4)).toBe(42);
  });

  it('set with 0 removes entry', () => {
    const grid = new AutotileGrid();
    grid.set(3, 4, 42);
    grid.set(3, 4, 0);
    expect(grid.get(3, 4)).toBe(0);
    expect(grid.has(3, 4)).toBe(false);
  });

  it('has returns correct value', () => {
    const grid = new AutotileGrid();
    expect(grid.has(1, 1)).toBe(false);
    grid.set(1, 1, 5);
    expect(grid.has(1, 1)).toBe(true);
  });

  it('remove works', () => {
    const grid = new AutotileGrid();
    grid.set(1, 1, 5);
    grid.remove(1, 1);
    expect(grid.get(1, 1)).toBe(0);
    expect(grid.size).toBe(0);
  });

  it('clear empties the grid', () => {
    const grid = new AutotileGrid();
    grid.set(1, 1, 5);
    grid.set(2, 2, 10);
    grid.clear();
    expect(grid.size).toBe(0);
  });

  it('size tracks entries correctly', () => {
    const grid = new AutotileGrid();
    expect(grid.size).toBe(0);
    grid.set(1, 1, 5);
    expect(grid.size).toBe(1);
    grid.set(2, 2, 10);
    expect(grid.size).toBe(2);
    grid.remove(1, 1);
    expect(grid.size).toBe(1);
  });

  it('entries iterates over all tiles', () => {
    const grid = new AutotileGrid();
    grid.set(1, 2, 5);
    grid.set(3, 4, 10);
    const entries = [...grid.entries()];
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual(['1:2', 5]);
    expect(entries).toContainEqual(['3:4', 10]);
  });

  it('overwrites existing values', () => {
    const grid = new AutotileGrid();
    grid.set(1, 1, 5);
    grid.set(1, 1, 10);
    expect(grid.get(1, 1)).toBe(10);
    expect(grid.size).toBe(1);
  });
});
