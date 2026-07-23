import { describe, it, expect } from 'vitest';
import { ZoneManager, type Polygon } from './zoneManager';

describe('ZoneManager', () => {
  it('tracks the current zone correctly', () => {
    const zones: Polygon[] = [
      {
        name: 'A',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      },
      {
        name: 'B',
        points: [
          { x: 20, y: 20 },
          { x: 30, y: 20 },
          { x: 30, y: 30 },
          { x: 20, y: 30 },
        ],
      },
    ];
    const zm = new ZoneManager(zones);

    zm.update({ x: 5, y: 5 });
    expect(zm.getCurrent()).toBe('A');

    zm.update({ x: 15, y: 15 });
    expect(zm.getCurrent()).toBeUndefined();

    zm.update({ x: 25, y: 25 });
    expect(zm.getCurrent()).toBe('B');
  });

  it('setZones() updates the list and exits the old zone when removed', () => {
    const zones: Polygon[] = [
      {
        name: 'A',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      },
      {
        name: 'B',
        points: [
          { x: 20, y: 20 },
          { x: 30, y: 20 },
          { x: 30, y: 30 },
          { x: 20, y: 30 },
        ],
      },
    ];
    const zm = new ZoneManager(zones);
    zm.update({ x: 5, y: 5 });
    expect(zm.getCurrent()).toBe('A');
    zm.setZones([
      {
        name: 'B',
        points: [
          { x: 20, y: 20 },
          { x: 30, y: 20 },
          { x: 30, y: 30 },
          { x: 20, y: 30 },
        ],
      },
    ]);
    expect(zm.getCurrent()).toBeUndefined();
  });

  it('setZones() keeps the current zone when it still exists', () => {
    const zones: Polygon[] = [
      {
        name: 'A',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      },
    ];
    const zm = new ZoneManager(zones);
    zm.update({ x: 5, y: 5 });
    expect(zm.getCurrent()).toBe('A');
    zm.setZones(zones);
    expect(zm.getCurrent()).toBe('A');
  });
});
