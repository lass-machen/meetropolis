import { describe, it, expect } from 'vitest';
import { assertSpriteCatalog, composeSheet } from '@meetropolis/shared';
import catalogJson from '@meetropolis/shared/sprite/catalog.json';
import { frontIdleCell, frontIdleFrame } from './spriteFrame';
import { initialConfig, setField } from './slotConfig';

const catalog = assertSpriteCatalog(catalogJson);
const { frame_w: fw, frame_h: fh } = catalog.format;

describe('frontIdleFrame', () => {
  it('returns the sheet top-left cell for a config', () => {
    const config = initialConfig(catalog);
    const frame = frontIdleFrame(catalog, config);
    expect(frame).not.toBeNull();
    expect(frame?.length).toBe(fw * fh * 4);
    expect(frame).toEqual(frontIdleCell(composeSheet(catalog, config), fw, fh));
  });

  it('memoises on canonical identity: the same config reuses one frame', () => {
    const config = initialConfig(catalog);
    const first = frontIdleFrame(catalog, config);
    const second = frontIdleFrame(catalog, { ...config });
    expect(second).toBe(first); // same reference => cache hit, not a re-render
  });

  it('shares a cache entry across configs that render identically', () => {
    // Under a dress, pants are not composed, so both configs canonicalise the same.
    const dress = setField(catalog, initialConfig(catalog), 'outfit', 'dress');
    const first = frontIdleFrame(catalog, { ...dress, pants: 'dark' });
    const second = frontIdleFrame(catalog, { ...dress, pants: 'navy' });
    expect(second).toBe(first);
  });

  it('renders visibly different frames for different options', () => {
    const base = initialConfig(catalog);
    const light = frontIdleFrame(catalog, setField(catalog, base, 'skin', 'light'));
    const dark = frontIdleFrame(catalog, setField(catalog, base, 'skin', 'dark'));
    expect(light).not.toEqual(dark);
  });

  it('returns null for an unrenderable config instead of throwing', () => {
    // The hood needs a top palette, so it is invalid with the base outfit; the
    // picker shows that option disabled and must not crash on its tile.
    const hooded = { ...initialConfig(catalog), outfit: 'base', hat: 'hood' };
    expect(frontIdleFrame(catalog, hooded)).toBeNull();
  });
});
