import { describe, it, expect, beforeEach } from 'vitest';
import { buildEditorSavePayload, saveJSON, keys } from './editorStorage';

describe('editorStorage', () => {
  beforeEach(() => {
    // @ts-ignore
    global.localStorage = {
      store: {} as Record<string, string>,
      getItem(key: string) { return this.store[key] ?? null; },
      setItem(key: string, value: string) { this.store[key] = value; },
      removeItem(key: string) { delete this.store[key]; },
      clear() { this.store = {}; }
    };
  });

  it('buildEditorSavePayload includes layers, assets, tilesets, bg and zones with replaceZones', () => {
    // prepare local data
    // @ts-ignore
    global.localStorage.setItem(keys.layers, JSON.stringify({ editorGround: [1,2], editorWalls: [3], collision: [4,5] }));
    // @ts-ignore
    global.localStorage.setItem(keys.assets, JSON.stringify([{ id: 'a' }]));
    // @ts-ignore
    global.localStorage.setItem(keys.tilesets, JSON.stringify([{ key: 't' }]));
    // @ts-ignore
    global.localStorage.setItem('meetropolis.backgroundColor', '#112233');

    const zones = [{ name: 'Z1', points: [{ x:0, y:0 }] }];
    const payload = buildEditorSavePayload(zones);
    expect(payload.editorGround).toEqual([1,2]);
    expect(payload.editorWalls).toEqual([3]);
    expect(payload.collision).toEqual([4,5]);
    expect(payload.assets).toEqual([{ id: 'a' }]);
    expect(payload.tilesets).toEqual([{ key: 't' }]);
    expect(payload.backgroundColor).toEqual('#112233');
    expect(payload.replaceZones).toBe(true);
    expect(payload.zones).toEqual(zones);
  });
});

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


