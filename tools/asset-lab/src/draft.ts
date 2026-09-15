import { assetDefinitions, buildAssets, themes, type AssetId, type AssetLibrary, type ThemeId } from './assets.ts';
import { defaultCharacter, parseCharacter, type Character } from './avatar.ts';
import { officePresets } from './office-presets.ts';
import type { OfficeId } from './office-model.ts';
import { rgba } from './pixels.ts';

export type PixelEdits = Record<string, string | null>;
export interface Draft {
  schema: 'meetropolis-asset-lab/v2';
  office: OfficeId;
  theme: ThemeId;
  character: Character;
  edits: Partial<Record<ThemeId, Partial<Record<AssetId, PixelEdits>>>>;
}
export const storageKey = 'meetropolis-asset-lab-v1';

export function newDraft(): Draft {
  return {
    schema: 'meetropolis-asset-lab/v2',
    office: 'loft',
    theme: 'holz',
    character: { ...defaultCharacter, proportion: 'kompakt' },
    edits: {},
  };
}

export function draftAssets(draft: Draft, theme = draft.theme): AssetLibrary {
  const assets = buildAssets(theme);
  for (const [id, edits] of Object.entries(draft.edits[theme] ?? {})) {
    const pixels = assets[id as AssetId];
    for (const [position, color] of Object.entries(edits)) {
      const [x, y] = position.split(',').map(Number);
      pixels.data.set(color ? rgba(color) : [0, 0, 0, 0], (y * pixels.width + x) * 4);
    }
  }
  return assets;
}

export function parseDraft(json: string): Draft {
  const input: unknown = JSON.parse(json);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Die Datei enthält kein Atelier-Rezept.');
  const v = input as Record<string, unknown>;
  if (
    (v.schema !== 'meetropolis-asset-lab/v1' && v.schema !== 'meetropolis-asset-lab/v2') ||
    typeof v.theme !== 'string' ||
    !Object.hasOwn(themes, v.theme)
  )
    throw new Error('Unbekannte Rezeptversion oder Stilrichtung.');
  const office = v.schema === 'meetropolis-asset-lab/v1' ? 'loft' : v.office;
  if (typeof office !== 'string' || !Object.hasOwn(officePresets, office))
    throw new Error('Das Rezept enthält eine unbekannte Bürovorlage.');
  const draft: Draft = {
    schema: 'meetropolis-asset-lab/v2',
    office: office as OfficeId,
    theme: v.theme as ThemeId,
    character: parseCharacter(v.character),
    edits: {},
  };
  if (!v.edits || typeof v.edits !== 'object' || Array.isArray(v.edits))
    throw new Error('Im Rezept fehlen die Pixeländerungen.');
  for (const [theme, assets] of Object.entries(v.edits as Record<string, unknown>)) {
    if (!Object.hasOwn(themes, theme) || !assets || typeof assets !== 'object' || Array.isArray(assets))
      throw new Error('Unbekannte Stilrichtung bei den Pixeländerungen.');
    const target: Partial<Record<AssetId, PixelEdits>> = {};
    const base = buildAssets(theme as ThemeId);
    for (const [id, edits] of Object.entries(assets as Record<string, unknown>)) {
      if (!Object.hasOwn(assetDefinitions, id) || !edits || typeof edits !== 'object' || Array.isArray(edits))
        throw new Error('Unbekanntes Asset bei den Pixeländerungen.');
      const pixels = base[id as AssetId];
      const parsed: PixelEdits = {};
      for (const [position, color] of Object.entries(edits as Record<string, unknown>)) {
        const [x, y] = position.split(',').map(Number);
        if (
          !/^\d+,\d+$/.test(position) ||
          x >= pixels.width ||
          y >= pixels.height ||
          !(color === null || (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)))
        )
          throw new Error(`Ungültiger Pixel in ${id}.`);
        parsed[position] = color;
      }
      target[id as AssetId] = parsed;
    }
    draft.edits[theme as ThemeId] = target;
  }
  return draft;
}
