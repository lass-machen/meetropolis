import { describe, it, expect } from 'vitest';
import { ZoneManager, type Polygon } from './zoneManager';

class DummyAV {
  public current: string | null = null;
  async switchTo(room: string) {
    this.current = room;
  }
}

describe('ZoneManager', () => {
  it('schaltet Räume korrekt um, wenn Position in Zonen wechselt', () => {
    const zones: Polygon[] = [
      { name: 'A', points: [ {x:0,y:0}, {x:10,y:0}, {x:10,y:10}, {x:0,y:10} ] },
      { name: 'B', points: [ {x:20,y:20}, {x:30,y:20}, {x:30,y:30}, {x:20,y:30} ] },
    ];
    const av = new DummyAV();
    const zm = new ZoneManager(zones, av as any);

    zm.update({ x: 5, y: 5 });
    expect(av.current).toBe('zone:A');
    expect(zm.getCurrent()).toBe('A');

    zm.update({ x: 15, y: 15 });
    expect(av.current).toBe('lobby');
    expect(zm.getCurrent()).toBeUndefined();

    zm.update({ x: 25, y: 25 });
    expect(av.current).toBe('zone:B');
    expect(zm.getCurrent()).toBe('B');
  });

  it('setZones() aktualisiert Liste und verlässt alte Zone wenn entfernt', () => {
    const zones: Polygon[] = [
      { name: 'A', points: [ {x:0,y:0}, {x:10,y:0}, {x:10,y:10}, {x:0,y:10} ] },
      { name: 'B', points: [ {x:20,y:20}, {x:30,y:20}, {x:30,y:30}, {x:20,y:30} ] },
    ];
    const av = new DummyAV();
    const zm = new ZoneManager(zones, av as any);
    zm.update({ x: 5, y: 5 });
    expect(zm.getCurrent()).toBe('A');
    zm.setZones([{ name: 'B', points: [ {x:20,y:20}, {x:30,y:20}, {x:30,y:30}, {x:20,y:30} ] }]);
    expect(zm.getCurrent()).toBeUndefined();
    expect(av.current).toBe('lobby');
  });
});


