import { describe, it, expect, beforeEach } from 'vitest';
import { loadJSON, saveJSON, keys, loadLayers, saveLayers, buildServerPayloadFromLocal } from './editorStorage';

describe('editorStorage', () => {
  beforeEach(() => {
    // @ts-expect-error - jsdom
    window.localStorage.clear();
  });

  it('loadJSON returns default on missing/bad data', () => {
    expect(loadJSON('missing', 123)).toBe(123);
    // bad data
    window.localStorage.setItem('bad', '{invalid');
    expect(loadJSON('bad', { ok: true })).toEqual({ ok: true });
  });

  it('save/load JSON roundtrip', () => {
    saveJSON('x', { a: 1 });
    expect(loadJSON('x', null)).toEqual({ a: 1 });
  });

  it('layers roundtrip + server payload', () => {
    const dump = { editorGround: [1, -1], editorWalls: null, collision: [2, 3], w: 2, h: 1 };
    saveLayers(dump);
    const loaded = loadLayers();
    expect(loaded).toEqual(dump);
    const payload = buildServerPayloadFromLocal();
    expect(payload).toEqual({ editorGround: [1, -1], editorWalls: null, collision: [2, 3] });
  });
});


