/**
 * EditorValidation Tests
 */

import { describe, it, expect } from 'vitest';
import {
  validateZoneNoOverlap,
  validateZoneName,
  validateZoneSize,
  validateAssetPlacement,
  validateTileset,
  validateSpawn,
  validateBackgroundColor,
  EditorValidationError,
} from './EditorValidation';

describe('EditorValidation', () => {
  describe('validateZoneNoOverlap', () => {
    it('should pass for non-overlapping zones', () => {
      const newZone = {
        name: 'Zone1',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      };

      const existingZones = [
        {
          name: 'Zone2',
          points: [
            { x: 200, y: 200 },
            { x: 300, y: 200 },
            { x: 300, y: 300 },
            { x: 200, y: 300 },
          ],
        },
      ];

      expect(() => {
        validateZoneNoOverlap(newZone, existingZones);
      }).not.toThrow();
    });

    it('should throw for overlapping zones', () => {
      const newZone = {
        name: 'Zone1',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      };

      const existingZones = [
        {
          name: 'Zone2',
          points: [
            { x: 50, y: 50 },
            { x: 150, y: 50 },
            { x: 150, y: 150 },
            { x: 50, y: 150 },
          ],
        },
      ];

      expect(() => {
        validateZoneNoOverlap(newZone, existingZones);
      }).toThrow(EditorValidationError);
    });

    it('should exclude specified index from overlap check', () => {
      const newZone = {
        name: 'Zone1',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      };

      const existingZones = [newZone]; // Same zone at index 0

      expect(() => {
        validateZoneNoOverlap(newZone, existingZones, 0);
      }).not.toThrow();
    });

    it('should throw for invalid zone (< 4 points)', () => {
      const newZone = {
        name: 'Zone1',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      };

      expect(() => {
        validateZoneNoOverlap(newZone, []);
      }).toThrow(EditorValidationError);
    });
  });

  describe('validateZoneName', () => {
    it('should pass for valid name', () => {
      expect(() => {
        validateZoneName('Valid Zone Name');
      }).not.toThrow();
    });

    it('should throw for empty name', () => {
      expect(() => {
        validateZoneName('');
      }).toThrow(EditorValidationError);
    });

    it('should throw for whitespace-only name', () => {
      expect(() => {
        validateZoneName('   ');
      }).toThrow(EditorValidationError);
    });

    it('should throw for too long name', () => {
      const longName = 'a'.repeat(101);
      expect(() => {
        validateZoneName(longName);
      }).toThrow(EditorValidationError);
    });
  });

  describe('validateZoneSize', () => {
    it('should pass for valid size', () => {
      expect(() => {
        validateZoneSize(0, 0, 5, 5, 1);
      }).not.toThrow();
    });

    it('should throw for too small zone', () => {
      expect(() => {
        validateZoneSize(0, 0, 0, 0, 2);
      }).toThrow(EditorValidationError);
    });

    it('should handle negative coordinates', () => {
      expect(() => {
        validateZoneSize(5, 5, 0, 0, 1);
      }).not.toThrow();
    });
  });

  describe('validateAssetPlacement', () => {
    it('should pass for valid placement', () => {
      expect(() => {
        validateAssetPlacement(5, 5, 100, 100);
      }).not.toThrow();
    });

    it('should throw for x out of bounds', () => {
      expect(() => {
        validateAssetPlacement(-1, 5, 100, 100);
      }).toThrow(EditorValidationError);

      expect(() => {
        validateAssetPlacement(100, 5, 100, 100);
      }).toThrow(EditorValidationError);
    });

    it('should throw for y out of bounds', () => {
      expect(() => {
        validateAssetPlacement(5, -1, 100, 100);
      }).toThrow(EditorValidationError);

      expect(() => {
        validateAssetPlacement(5, 100, 100, 100);
      }).toThrow(EditorValidationError);
    });
  });

  describe('validateTileset', () => {
    it('should pass for valid tileset', () => {
      expect(() => {
        validateTileset({
          key: 'test',
          dataUrl: 'data:image/png;base64,test',
          tileWidth: 32,
          tileHeight: 32,
        });
      }).not.toThrow();
    });

    it('should throw for empty key', () => {
      expect(() => {
        validateTileset({
          key: '',
          dataUrl: 'data:image/png;base64,test',
          tileWidth: 32,
          tileHeight: 32,
        });
      }).toThrow(EditorValidationError);
    });

    it('should throw for missing dataUrl', () => {
      expect(() => {
        validateTileset({
          key: 'test',
          dataUrl: '',
          tileWidth: 32,
          tileHeight: 32,
        });
      }).toThrow(EditorValidationError);
    });

    it('should throw for invalid dimensions', () => {
      expect(() => {
        validateTileset({
          key: 'test',
          dataUrl: 'data:image/png;base64,test',
          tileWidth: 0,
          tileHeight: 32,
        });
      }).toThrow(EditorValidationError);

      expect(() => {
        validateTileset({
          key: 'test',
          dataUrl: 'data:image/png;base64,test',
          tileWidth: 32,
          tileHeight: -1,
        });
      }).toThrow(EditorValidationError);
    });

    it('should throw for too large dimensions', () => {
      expect(() => {
        validateTileset({
          key: 'test',
          dataUrl: 'data:image/png;base64,test',
          tileWidth: 300,
          tileHeight: 32,
        });
      }).toThrow(EditorValidationError);
    });
  });

  describe('validateSpawn', () => {
    it('should pass for valid spawn', () => {
      expect(() => {
        validateSpawn(5, 5, 100, 100);
      }).not.toThrow();
    });

    it('should throw for spawn out of bounds', () => {
      expect(() => {
        validateSpawn(-1, 5, 100, 100);
      }).toThrow(EditorValidationError);

      expect(() => {
        validateSpawn(5, -1, 100, 100);
      }).toThrow(EditorValidationError);

      expect(() => {
        validateSpawn(100, 5, 100, 100);
      }).toThrow(EditorValidationError);

      expect(() => {
        validateSpawn(5, 100, 100, 100);
      }).toThrow(EditorValidationError);
    });
  });

  describe('validateBackgroundColor', () => {
    it('should pass for valid hex color', () => {
      expect(() => {
        validateBackgroundColor('#ff0000');
      }).not.toThrow();

      expect(() => {
        validateBackgroundColor('#ABC123');
      }).not.toThrow();
    });

    it('should throw for invalid color format', () => {
      expect(() => {
        validateBackgroundColor('red');
      }).toThrow(EditorValidationError);

      expect(() => {
        validateBackgroundColor('#fff');
      }).toThrow(EditorValidationError);

      expect(() => {
        validateBackgroundColor('#gggggg');
      }).toThrow(EditorValidationError);

      expect(() => {
        validateBackgroundColor('ff0000');
      }).toThrow(EditorValidationError);
    });
  });
});

