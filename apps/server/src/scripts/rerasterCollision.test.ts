import { describe, expect, it, vi } from 'vitest';
import { ObjectFootprintLimitError } from '../api/utils/objectFootprintLimits.js';
import { rerasterMaps } from './rerasterCollision.js';

describe('rerasterMaps', () => {
  it('skips maps over the footprint limit and processes the rest', async () => {
    const seen: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await rerasterMaps([{ id: 'a' }, { id: 'b' }, { id: 'c' }], (map) => {
        if (map.id === 'b') return Promise.reject(new ObjectFootprintLimitError());
        seen.push(map.id);
        return Promise.resolve();
      });

      expect(result).toEqual({ processed: 2, skipped: 1 });
      expect(seen).toEqual(['a', 'c']);
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects when processOne throws another error', async () => {
    await expect(rerasterMaps([{ id: 'a' }], () => Promise.reject(new Error('db down')))).rejects.toThrow('db down');
  });
});
