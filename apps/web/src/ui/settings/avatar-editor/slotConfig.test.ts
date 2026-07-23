import { describe, it, expect } from 'vitest';
import { assertSpriteCatalog, validateConfig } from '@meetropolis/shared';
import catalogJson from '@meetropolis/shared/sprite/catalog.json';
import { initialConfig, isApplicable, isOptionEnabled, setField } from './slotConfig';

// Vite resolves the JSON import to the same catalog the runtime fetches.
const catalog = assertSpriteCatalog(catalogJson);

describe('slotConfig', () => {
  it('initialConfig is a valid, renderable config', () => {
    expect(validateConfig(catalog, initialConfig(catalog)).ok).toBe(true);
  });

  it('isApplicable hides pants for dress/base and beard_color without a beard', () => {
    const base = initialConfig(catalog);
    expect(isApplicable(catalog, base, 'pants')).toBe(true); // trousers
    expect(isApplicable(catalog, { ...base, outfit: 'dress' }, 'pants')).toBe(false);
    expect(isApplicable(catalog, { ...base, outfit: 'base' }, 'shoes')).toBe(false);
    expect(isApplicable(catalog, base, 'beard_color')).toBe(false);
    expect(isApplicable(catalog, { ...base, beard: 'vollbart' }, 'beard_color')).toBe(true);
  });

  it('isOptionEnabled disables hood under the base outfit', () => {
    const base = initialConfig(catalog);
    expect(isOptionEnabled(catalog, base, 'hat', 'hood')).toBe(true); // trousers
    expect(isOptionEnabled(catalog, { ...base, outfit: 'base' }, 'hat', 'hood')).toBe(false);
    expect(isOptionEnabled(catalog, base, 'hat', 'cap')).toBe(true);
  });

  it('setField keeps the config valid: switching to base clears the hood', () => {
    const start = setField(catalog, initialConfig(catalog), 'hat', 'hood');
    expect(start.hat).toBe('hood');
    const toBase = setField(catalog, start, 'outfit', 'base');
    expect(toBase.hat).toBeNull();
    expect(validateConfig(catalog, toBase).ok).toBe(true);
  });

  it('setField backfills required palette fields when they would go missing', () => {
    const base = initialConfig(catalog);
    // Force pants empty, then a change should refill it since trousers needs it.
    const withoutPants = { ...base, pants: null };
    const refilled = setField(catalog, withoutPants, 'skin', base.skin);
    expect(typeof refilled.pants).toBe('string');
    expect(validateConfig(catalog, refilled).ok).toBe(true);
  });
});
