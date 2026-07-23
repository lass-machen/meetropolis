import { describe, it, expect } from 'vitest';
import { assertSpriteCatalog } from '@meetropolis/shared';
import catalogJson from '@meetropolis/shared/sprite/catalog.json';
import { EDITOR_TABS, groupsForTab, isColorField, paletteRampFor } from './editorLayout';
import { SLOT_GROUPS, initialConfig, optionsForField } from './slotConfig';

const catalog = assertSpriteCatalog(catalogJson);

describe('editorLayout tabs', () => {
  it('covers every slot exactly once', () => {
    const tabbed = EDITOR_TABS.flatMap((tab) => tab.fields);
    expect([...tabbed].sort()).toEqual(SLOT_GROUPS.map((g) => g.field).sort());
    expect(new Set(tabbed).size).toBe(tabbed.length);
  });

  it('groupsForTab returns the tab slots in SLOT_GROUPS order', () => {
    const base = initialConfig(catalog);
    expect(groupsForTab(catalog, base, 'body').map((g) => g.field)).toEqual(['skin', 'hair', 'hair_color']);
  });

  it('groupsForTab hides slots the catalog rules do not apply', () => {
    const base = initialConfig(catalog);
    // trousers uses top/pants/shoes; a dress drops pants.
    expect(groupsForTab(catalog, base, 'clothing').map((g) => g.field)).toEqual(['outfit', 'top', 'pants', 'shoes']);
    expect(groupsForTab(catalog, { ...base, outfit: 'dress' }, 'clothing').map((g) => g.field)).toEqual([
      'outfit',
      'top',
      'shoes',
    ]);
    expect(groupsForTab(catalog, { ...base, outfit: 'base' }, 'clothing').map((g) => g.field)).toEqual(['outfit']);
  });

  it('groupsForTab shows beard_color only with a beard', () => {
    const base = initialConfig(catalog);
    expect(groupsForTab(catalog, base, 'extras').map((g) => g.field)).toEqual(['beard', 'glasses', 'hat', 'misc']);
    expect(groupsForTab(catalog, { ...base, beard: 'vollbart' }, 'extras').map((g) => g.field)).toEqual([
      'beard',
      'beard_color',
      'glasses',
      'hat',
      'misc',
    ]);
  });

  it('groupsForTab is empty for an unknown tab', () => {
    expect(groupsForTab(catalog, initialConfig(catalog), 'nope')).toEqual([]);
  });

  it('no tab is ever empty for a valid config', () => {
    const base = initialConfig(catalog);
    for (const tab of EDITOR_TABS) {
      expect(groupsForTab(catalog, base, tab.key).length).toBeGreaterThan(0);
    }
  });
});

describe('editorLayout colour vs item slots', () => {
  it('classifies the palette-picked slots as colour, garments as items', () => {
    for (const field of ['skin', 'hair_color', 'beard_color', 'pants', 'shoes']) {
      expect(isColorField(field)).toBe(true);
    }
    // `top` is palette-driven too but is picked as a garment, so it stays a sprite tile.
    for (const field of ['hair', 'outfit', 'top', 'beard', 'glasses', 'hat', 'misc']) {
      expect(isColorField(field)).toBe(false);
    }
  });

  it('every colour slot resolves a non-empty ramp for every catalog value', () => {
    for (const group of SLOT_GROUPS.filter((g) => isColorField(g.field))) {
      for (const value of optionsForField(catalog, group.field)) {
        expect(paletteRampFor(catalog, group.field, value).length, `${group.field}=${value}`).toBeGreaterThan(0);
      }
    }
  });

  it('resolves the ramp through palette_compose, brightest first', () => {
    // skin.light = a #ffdec5 (highlight), b #fdcbb0, c #e09782 (shadow).
    expect(paletteRampFor(catalog, 'skin', 'light')).toEqual(['#ffdec5', '#fdcbb0', '#e09782']);
    // hair_color reads palettes.hair, beard_color reads palettes.beard.
    expect(paletteRampFor(catalog, 'hair_color', 'blond')).toEqual(['#f9c22b', '#f79617', '#cd683d']);
    expect(paletteRampFor(catalog, 'beard_color', 'schwarz')).toEqual(['#45293f', '#2e222f', '#1a1420']);
    // shoes.brown is stored s/r/d — the ramp sorts it light -> dark regardless.
    expect(paletteRampFor(catalog, 'shoes', 'brown')).toEqual(['#a06849', '#6b3a26', '#3f2417']);
  });

  it('returns an empty ramp for unknown fields and values', () => {
    expect(paletteRampFor(catalog, 'hair', 'messy')).toEqual([]); // not a keyed palette field
    expect(paletteRampFor(catalog, 'skin', 'chartreuse')).toEqual([]);
  });
});

describe('editorLayout catalog assumptions', () => {
  it('the sprite frame is 32x32, as the editor CSS assumes', () => {
    // avatarEditor.css sizes the stage and tiles off --av-frame: 32.
    expect(catalog.format.frame_w).toBe(32);
    expect(catalog.format.frame_h).toBe(32);
  });
});
