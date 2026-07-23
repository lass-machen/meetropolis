// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { loadFromPacks, lookupDirectionalImage, hasDirectionalImages, clearRegistry } from './directionalImageRegistry';

describe('directionalImageRegistry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  const mockPacks = [
    {
      uuid: 'pack-1',
      objects: [
        {
          id: 'chair',
          key: 'chair',
          directionalImages: [
            { rotation: 0, dataURL: 'data:image/png;base64,chair0' },
            { rotation: 90, dataURL: 'data:image/png;base64,chair90' },
            { rotation: 180, dataURL: 'data:image/png;base64,chair180' },
            { rotation: 270, dataURL: 'data:image/png;base64,chair270' },
          ],
        },
        {
          id: 'table',
          key: 'table',
          directionalImages: [
            { rotation: 0, dataURL: 'data:image/png;base64,table0' },
            { rotation: 90, dataURL: 'data:image/png;base64,table90' },
          ],
        },
        {
          id: 'lamp',
          key: 'lamp',
          // No directional images
        },
      ],
    },
    {
      uuid: 'pack-2',
      objects: [
        {
          id: 'desk',
          key: 'desk',
          directionalImages: [{ rotation: 0, dataURL: 'data:image/png;base64,desk0' }],
        },
      ],
    },
  ];

  describe('loadFromPacks', () => {
    it('should populate registry from packs', () => {
      loadFromPacks(mockPacks);
      expect(hasDirectionalImages('pack-1', 'chair')).toBe(true);
      expect(hasDirectionalImages('pack-1', 'table')).toBe(true);
      expect(hasDirectionalImages('pack-2', 'desk')).toBe(true);
    });

    it('should skip objects without directionalImages', () => {
      loadFromPacks(mockPacks);
      expect(hasDirectionalImages('pack-1', 'lamp')).toBe(false);
    });

    it('should clear previous entries on reload', () => {
      loadFromPacks(mockPacks);
      expect(hasDirectionalImages('pack-1', 'chair')).toBe(true);

      loadFromPacks([]);
      expect(hasDirectionalImages('pack-1', 'chair')).toBe(false);
    });

    it('should handle empty packs array', () => {
      loadFromPacks([]);
      expect(hasDirectionalImages('pack-1', 'chair')).toBe(false);
    });

    it('should handle packs without objects', () => {
      loadFromPacks([{ uuid: 'empty-pack' }]);
      expect(hasDirectionalImages('empty-pack', 'anything')).toBe(false);
    });

    it('should skip packs without uuid', () => {
      loadFromPacks([{ objects: [{ id: 'x', directionalImages: [{ rotation: 0, dataURL: 'test' }] }] }]);
      expect(hasDirectionalImages('undefined', 'x')).toBe(false);
    });
  });

  describe('lookupDirectionalImage', () => {
    beforeEach(() => {
      loadFromPacks(mockPacks);
    });

    it('should return dataURL for matching rotation', () => {
      expect(lookupDirectionalImage('pack-1', 'chair', 0)).toBe('data:image/png;base64,chair0');
      expect(lookupDirectionalImage('pack-1', 'chair', 90)).toBe('data:image/png;base64,chair90');
      expect(lookupDirectionalImage('pack-1', 'chair', 180)).toBe('data:image/png;base64,chair180');
      expect(lookupDirectionalImage('pack-1', 'chair', 270)).toBe('data:image/png;base64,chair270');
    });

    it('should return null for non-matching rotation', () => {
      expect(lookupDirectionalImage('pack-1', 'table', 180)).toBeNull();
      expect(lookupDirectionalImage('pack-1', 'table', 270)).toBeNull();
    });

    it('should return null for unknown item', () => {
      expect(lookupDirectionalImage('pack-1', 'unknown', 0)).toBeNull();
    });

    it('should return null for unknown pack', () => {
      expect(lookupDirectionalImage('unknown-pack', 'chair', 0)).toBeNull();
    });

    it('should return null for items without directional images', () => {
      expect(lookupDirectionalImage('pack-1', 'lamp', 0)).toBeNull();
    });
  });

  describe('hasDirectionalImages', () => {
    it('should return false for empty registry', () => {
      expect(hasDirectionalImages('pack-1', 'chair')).toBe(false);
    });

    it('should return true for registered items', () => {
      loadFromPacks(mockPacks);
      expect(hasDirectionalImages('pack-1', 'chair')).toBe(true);
    });

    it('should return false for unregistered items', () => {
      loadFromPacks(mockPacks);
      expect(hasDirectionalImages('pack-1', 'lamp')).toBe(false);
    });
  });

  describe('clearRegistry', () => {
    it('should clear all entries', () => {
      loadFromPacks(mockPacks);
      expect(hasDirectionalImages('pack-1', 'chair')).toBe(true);

      clearRegistry();
      expect(hasDirectionalImages('pack-1', 'chair')).toBe(false);
    });
  });
});
