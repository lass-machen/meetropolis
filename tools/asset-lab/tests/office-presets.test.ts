import { describe, expect, it } from 'vitest';
import { assetCollisionFootprint, buildAssets, type AssetLibrary } from '../src/assets.ts';
import { officeList, officePresets } from '../src/office-presets.ts';
import type { OfficePreset, Point, Rect } from '../src/office-model.ts';
import { canStand, collisions, findPath, roomImage, zoneAt } from '../src/world.ts';

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const footprintAt = (office: OfficePreset, assets: AssetLibrary, id: string): Rect => {
  const placement = office.placements.find((item) => item.id === id)!;
  const footprint = assetCollisionFootprint(placement.asset, assets[placement.asset]);
  if (!footprint) throw new Error(`Asset ${id} hat keinen Fußabdruck.`);
  return {
    x: placement.x + footprint.x,
    y: placement.y + footprint.y,
    w: footprint.w,
    h: footprint.h,
  };
};

const pathTo = (office: OfficePreset, obstacles: Rect[], target: Point): void => {
  expect(canStand(target, obstacles, office.bounds)).toBe(true);
  const path = findPath(office.spawn, target, obstacles, office.bounds);
  expect(path.length, `Kein Weg zu (${target.x}, ${target.y})`).toBeGreaterThan(0);
  expect(path.at(-1)).toEqual(target);
  for (const point of path) expect(canStand(point, obstacles, office.bounds)).toBe(true);
};

describe('Bürogrundrisse', () => {
  it('exportiert genau die drei bestätigten Presets', () => {
    expect(Object.keys(officePresets)).toEqual(['loft', 'studio', 'campus']);
    expect(officeList.map((office) => office.id)).toEqual(['loft', 'studio', 'campus']);
    expect(officeList.map((office) => office.capacity)).toEqual([6, 12, 24]);
  });

  for (const office of officeList) {
    it(`${office.id}: Arbeitsplätze, IDs und Raster bleiben vollständig`, () => {
      const assets = buildAssets(office.defaultTheme);
      const desks = office.placements.filter((item) => item.asset === 'compact_desk');
      const workplaceChairs = desks.map((desk) =>
        office.placements.find((item) => item.id === desk.id.replace(/-desk$/, '-chair'))!,
      );
      const meetingSeats = office.placements.filter((item) => item.id.includes('-meeting-seat-'));
      expect(desks).toHaveLength(office.capacity);
      expect(workplaceChairs).toHaveLength(office.capacity);
      expect(workplaceChairs.every((item) => item?.asset === 'compact_chair_north')).toBe(true);
      expect(meetingSeats).toHaveLength(office.id === 'loft' ? 4 : 6);
      expect(office.workplaces).toHaveLength(office.capacity);
      expect(office.workplaces.map((item) => item.id)).toEqual(desks.map((item) => item.id));
      expect(new Set(office.placements.map((item) => item.id)).size).toBe(office.placements.length);
      expect(new Set(office.workplaces.map((item) => item.id)).size).toBe(office.workplaces.length);
      expect(office.world.tile).toBe(16);
      expect(office.world.width).toBeGreaterThan(576);
      expect(office.world.height).toBeGreaterThan(384);

      for (const desk of desks) {
        const chair = office.placements.find((item) => item.id === desk.id.replace(/-desk$/, '-chair'))!;
        const workplace = office.workplaces.find((item) => item.id === desk.id)!;
        expect({ x: chair.x, y: chair.y }).toEqual({ x: desk.x + 16, y: desk.y + 32 });
        expect(workplace.approach).toEqual({ x: desk.x + 24, y: desk.y + 40 });
      }

      for (const item of office.placements) {
        expect(item.x % 16).toBe(0);
        expect(item.y % 16).toBe(0);
        expect(item.x).toBeGreaterThanOrEqual(0);
        expect(item.y).toBeGreaterThanOrEqual(0);
        expect(item.x + assets[item.asset].width).toBeLessThanOrEqual(office.world.width);
        expect(item.y + assets[item.asset].height).toBeLessThanOrEqual(office.world.height);
      }
      for (const wall of office.walls) {
        expect(wall.x % 16).toBe(0);
        expect(wall.y % 16).toBe(0);
        expect(wall.x).toBeGreaterThanOrEqual(office.bounds.x);
        expect(wall.y).toBeGreaterThanOrEqual(office.bounds.y);
        expect(wall.x + 16).toBeLessThanOrEqual(office.bounds.x + office.bounds.w);
        expect(wall.y + 16).toBeLessThanOrEqual(office.bounds.y + office.bounds.h);
        expect(wall.y - 32).toBeGreaterThanOrEqual(0);
      }

      const workstationRects = office.placements
        .filter((item) => assetCollisionFootprint(item.asset, assets[item.asset]))
        .map((item) => footprintAt(office, assets, item.id));
      for (let i = 0; i < workstationRects.length; i++)
        for (let j = i + 1; j < workstationRects.length; j++)
          expect(intersects(workstationRects[i], workstationRects[j])).toBe(false);
    });

    it(`${office.id}: Spawn, Zonen und alle Arbeitsplatz-Approaches sind erreichbar`, () => {
      const assets = buildAssets(office.defaultTheme);
      const obstacles = collisions(office, assets);
      expect(canStand(office.spawn, obstacles, office.bounds)).toBe(true);
      for (const zone of office.zones) {
        expect(zone.entry.x).toBeGreaterThanOrEqual(zone.x);
        expect(zone.entry.x).toBeLessThan(zone.x + zone.w);
        expect(zone.entry.y).toBeGreaterThanOrEqual(zone.y);
        expect(zone.entry.y).toBeLessThan(zone.y + zone.h);
        expect(zoneAt(zone.entry, office)?.id).toBe(zone.id);
        expect(canStand(zone.entry, obstacles, office.bounds)).toBe(true);
        pathTo(office, obstacles, zone.entry);
      }
      for (const workplace of office.workplaces) {
        expect(canStand(workplace.approach, obstacles, office.bounds)).toBe(true);
        pathTo(office, obstacles, workplace.approach);
        const desk = office.placements.find((item) => item.id === workplace.id)!;
        const chair = office.placements.find((item) => item.id === desk.id.replace(/-desk$/, '-chair'));
        expect(desk.asset).toBe('compact_desk');
        expect(chair?.asset).toBe('compact_chair_north');
        const deskFoot = footprintAt(office, assets, desk.id);
        const chairFoot = chair ? footprintAt(office, assets, chair.id) : undefined;
        expect(
          chairFoot && intersects({ x: workplace.approach.x, y: workplace.approach.y, w: 1, h: 1 }, chairFoot),
        ).toBe(false);
        expect(intersects({ x: workplace.approach.x, y: workplace.approach.y, w: 1, h: 1 }, deskFoot)).toBe(false);
      }
    });

    it(`${office.id}: Besprechungsstühle haben Richtungsvarianten und freie Zugänge`, () => {
      const assets = buildAssets(office.defaultTheme);
      const obstacles = collisions(office, assets);
      const seats = office.placements.filter((item) => item.id.includes('-meeting-seat-'));
      expect(seats.filter((item) => item.asset === 'compact_chair_north')).toHaveLength(2);
      expect(seats.filter((item) => item.asset === 'compact_chair')).toHaveLength(2);
      if (office.id !== 'loft') {
        expect(seats.filter((item) => item.asset === 'compact_chair_west')).toHaveLength(1);
        expect(seats.filter((item) => item.asset === 'compact_chair_east')).toHaveLength(1);
      }
      for (const seat of seats) {
        const approach =
          seat.asset === 'compact_chair_north'
            ? { x: seat.x + 16, y: seat.y + 8 }
            : seat.asset === 'compact_chair'
              ? { x: seat.x + 16, y: seat.y + 8 }
              : seat.id.endsWith('-west')
                ? { x: seat.x - 8, y: seat.y + 24 }
                : { x: seat.x + 40, y: seat.y + 24 };
        expect(canStand(approach, obstacles, office.bounds)).toBe(true);
        pathTo(office, obstacles, approach);
      }
    });

    it(`${office.id}: Innenwände blockieren echte Kacheln`, () => {
      const assets = buildAssets(office.defaultTheme);
      const obstacles = collisions(office, assets);
      for (const x of new Set(office.walls.map((wall) => wall.x))) {
        const rows = office.walls
          .filter((wall) => wall.x === x)
          .map((wall) => wall.y)
          .sort((a, b) => a - b);
        for (let i = 1; i < rows.length; i++)
          expect(rows[i] - rows[i - 1] === 16 || rows[i] - rows[i - 1] >= 48).toBe(true);
      }
      for (const wall of office.walls) {
        expect(obstacles).toContainEqual({ ...wall, w: 16, h: 16 });
        expect(canStand({ x: wall.x + 8, y: wall.y + 8 }, obstacles, office.bounds)).toBe(false);
      }
    });

    it(`${office.id}: Eingang liegt südlich an der Ankunft`, () => {
      const door = office.placements.find((item) => item.id === `${office.id}-door`)!;
      expect(door.asset).toBe('door_open');
      expect(door.y + 48).toBe(office.bounds.y + office.bounds.h);
      expect(office.zones.find((item) => item.kind === 'arrival')?.entry).toEqual(office.spawn);
    });

    it(`${office.id}: roomImage verwendet Weltgröße und Preset`, () => {
      const image = roomImage(office.defaultTheme, buildAssets(office.defaultTheme), office);
      expect(image.width).toBe(office.world.width);
      expect(image.height).toBe(office.world.height);
    });
  }
});
