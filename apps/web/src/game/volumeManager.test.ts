import { describe, it, expect } from 'vitest';
import { computePairVolume, type Polygon } from './volumeManager';

const square = (x: number, y: number, w: number, name: string): Polygon => ({
  name,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + w },
    { x, y: y + w },
  ],
});

describe('computePairVolume', () => {
  const rules = { nearRadius: 100, farRadius: 300, outsideBubbleAttenuation: 0.2 };
  const zones = [square(0, 0, 200, 'A'), square(300, 0, 200, 'B')];

  it('is full volume inside same zone', () => {
    const v = computePairVolume(
      { id: 'me', x: 50, y: 50 },
      { id: 'u1', x: 150, y: 150 },
      zones,
      null,
      new Set(),
      rules
    );
    expect(v).toBe(1);
  });

  it('attenuates by distance outside zones', () => {
    const vNear = computePairVolume(
      { id: 'me', x: 250, y: 250 },
      { id: 'u1', x: 300, y: 250 },
      zones,
      null,
      new Set(),
      rules
    );
    const vFar = computePairVolume(
      { id: 'me', x: 250, y: 250 },
      { id: 'u1', x: 600, y: 250 },
      zones,
      null,
      new Set(),
      rules
    );
    expect(vNear).toBeGreaterThan(0.9);
    expect(vFar).toBe(0);
  });

  it('bubble members hear full volume', () => {
    const v = computePairVolume(
      // Beide außerhalb von Zonen
      { id: 'me', x: 250, y: 250 },
      { id: 'u2', x: 260, y: 260 },
      zones,
      null,
      new Set(['me', 'u2']),
      rules
    );
    expect(v).toBe(1);
  });

  it('bubble vs outside attenuates strongly', () => {
    const v1 = computePairVolume(
      { id: 'me', x: 10, y: 10 },
      { id: 'out', x: 12, y: 12 },
      zones,
      null,
      new Set(['me']),
      rules
    );
    const v2 = computePairVolume(
      { id: 'me', x: 10, y: 10 },
      { id: 'out', x: 12, y: 12 },
      zones,
      null,
      new Set(['out']),
      rules
    );
    expect(v1).toBeCloseTo(0.2, 5);
    expect(v2).toBeCloseTo(0.2, 5);
  });

  it('follow target is always full volume', () => {
    const v = computePairVolume(
      { id: 'me', x: 0, y: 0 },
      { id: 'u', x: 2000, y: 2000 },
      zones,
      'u',
      new Set(),
      rules
    );
    expect(v).toBe(1);
  });
});


