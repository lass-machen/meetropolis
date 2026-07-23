import { describe, it, expect } from 'vitest';
import type { Player, Bubble, Zone, MapMeta, MessageEvent, PlayerId } from './types.js';

describe('Shared Types', () => {
  describe('Player', () => {
    it('should accept valid player objects', () => {
      const player: Player = {
        id: 'player-123',
        x: 100,
        y: 200,
        direction: 'down',
      };

      expect(player.id).toBe('player-123');
      expect(player.x).toBe(100);
      expect(player.y).toBe(200);
      expect(player.direction).toBe('down');
    });

    it('should accept all valid directions', () => {
      const directions: Player['direction'][] = ['up', 'down', 'left', 'right'];

      directions.forEach((dir) => {
        const player: Player = { id: '1', x: 0, y: 0, direction: dir };
        expect(player.direction).toBe(dir);
      });
    });
  });

  describe('Bubble', () => {
    it('should accept valid bubble objects', () => {
      const bubble: Bubble = {
        id: 'bubble-1',
        members: ['player-1', 'player-2'],
        center: { x: 150, y: 250 },
        radius: 100,
      };

      expect(bubble.id).toBe('bubble-1');
      expect(bubble.members).toHaveLength(2);
      expect(bubble.center.x).toBe(150);
      expect(bubble.radius).toBe(100);
    });

    it('should handle empty member list', () => {
      const bubble: Bubble = {
        id: 'empty-bubble',
        members: [],
        center: { x: 0, y: 0 },
        radius: 50,
      };

      expect(bubble.members).toHaveLength(0);
    });
  });

  describe('Zone', () => {
    it('should accept valid zone with capacity', () => {
      const zone: Zone = {
        id: 'zone-1',
        name: 'Meeting Room',
        capacity: 10,
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        roomId: 'room-123',
      };

      expect(zone.name).toBe('Meeting Room');
      expect(zone.capacity).toBe(10);
      expect(zone.polygon).toHaveLength(4);
    });

    it('should accept zone without capacity', () => {
      const zone: Zone = {
        id: 'zone-2',
        name: 'Open Space',
        polygon: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
        ],
        roomId: 'room-456',
      };

      expect(zone.capacity).toBeUndefined();
    });
  });

  describe('MapMeta', () => {
    it('should accept valid map metadata', () => {
      const mapMeta: MapMeta = {
        id: 'map-1',
        name: 'Office Floor 1',
        tileWidth: 32,
        tileHeight: 32,
      };

      expect(mapMeta.name).toBe('Office Floor 1');
      expect(mapMeta.tileWidth).toBe(32);
    });
  });

  describe('MessageEvent', () => {
    it('should accept bubble:join event', () => {
      const event: MessageEvent = {
        type: 'bubble:join',
        bubbleId: 'bubble-1',
        playerId: 'player-1',
      };

      expect(event.type).toBe('bubble:join');
    });

    it('should accept bubble:leave event', () => {
      const event: MessageEvent = {
        type: 'bubble:leave',
        bubbleId: 'bubble-1',
        playerId: 'player-1',
      };

      expect(event.type).toBe('bubble:leave');
    });

    it('should accept zone:enter event', () => {
      const event: MessageEvent = {
        type: 'zone:enter',
        zoneId: 'zone-1',
        playerId: 'player-1',
      };

      expect(event.type).toBe('zone:enter');
    });

    it('should accept zone:leave event', () => {
      const event: MessageEvent = {
        type: 'zone:leave',
        zoneId: 'zone-1',
        playerId: 'player-1',
      };

      expect(event.type).toBe('zone:leave');
    });
  });

  describe('PlayerId', () => {
    it('should be a string type', () => {
      const id: PlayerId = 'any-string-id';
      expect(typeof id).toBe('string');
    });
  });
});

// Utility function tests (if any exist in shared package)
describe('Type Guards and Utilities', () => {
  it('should validate player position bounds', () => {
    const isValidPosition = (x: number, y: number): boolean => {
      return x >= 0 && y >= 0 && Number.isFinite(x) && Number.isFinite(y);
    };

    expect(isValidPosition(100, 200)).toBe(true);
    expect(isValidPosition(-1, 100)).toBe(false);
    expect(isValidPosition(Infinity, 100)).toBe(false);
    expect(isValidPosition(NaN, 100)).toBe(false);
  });

  it('should calculate bubble center from members', () => {
    const calculateCenter = (members: { x: number; y: number }[]): { x: number; y: number } => {
      if (members.length === 0) return { x: 0, y: 0 };
      const sum = members.reduce((acc, m) => ({ x: acc.x + m.x, y: acc.y + m.y }), { x: 0, y: 0 });
      return { x: sum.x / members.length, y: sum.y / members.length };
    };

    const center = calculateCenter([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 0 },
    ]);

    expect(center.x).toBe(100);
    expect(center.y).toBeCloseTo(33.33, 1);
  });

  it('should check if point is inside polygon', () => {
    const isPointInPolygon = (point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean => {
      // Ray-casting algorithm
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x,
          yi = polygon[i].y;
        const xj = polygon[j].x,
          yj = polygon[j].y;
        const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];

    expect(isPointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(isPointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(isPointInPolygon({ x: -10, y: 50 }, square)).toBe(false);
  });
});
