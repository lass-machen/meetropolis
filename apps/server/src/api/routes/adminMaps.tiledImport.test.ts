import { describe, expect, it } from 'vitest';
import { hasReservedAutotileLayer } from './adminMaps.tiledImport.js';

describe('Tiled map import layer validation', () => {
  it('rejects raw values in the reserved walls_auto layer', () => {
    expect(
      hasReservedAutotileLayer({
        layers: [{ type: 'tilelayer', name: 'walls_auto', data: [1] }],
      }),
    ).toBe(true);
  });

  it('allows ordinary tile layers and similarly named object layers', () => {
    expect(
      hasReservedAutotileLayer({
        layers: [
          { type: 'tilelayer', name: 'walls', data: [1] },
          { type: 'objectgroup', name: 'walls_auto', objects: [] },
        ],
      }),
    ).toBe(false);
  });
});
