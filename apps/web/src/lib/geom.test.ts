import { describe, it, expect } from 'vitest';
import { rectsOverlap, pointInPolygon } from './geom';

describe('geom', () => {
  it('rectsOverlap detects overlap', () => {
    const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const b = { x0: 5, y0: 5, x1: 15, y1: 15 };
    expect(rectsOverlap(a, b)).toBe(true);
  });

  it('rectsOverlap detects separation', () => {
    const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const b = { x0: 10, y0: 10, x1: 20, y1: 20 }; // touching at corner
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it('pointInPolygon basic', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
  });
});


