import { describe, it, expect } from 'vitest';
import { ZoneManager, type Polygon } from './zoneManager';

class DummyAV {
  public current: string | null = null;
  switchTo(room: string) {
    this.current = room;
  }
}

describe('ZoneManager', () => {
  it('tracks the current zone correctly (single-room, no more AV switch)', () => {
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
    const av = new DummyAV();
    const zm = new ZoneManager(zones, av as any);

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
    const av = new DummyAV();
    const zm = new ZoneManager(zones, av as any);
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
    expect(av.current).toBe('lobby'); // legacy expectation, not critical here
  });
});
