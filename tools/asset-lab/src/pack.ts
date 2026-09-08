import JSZip from 'jszip';
import {
  assetDefinitions,
  directionalAssets,
  themes,
  type AssetId,
  type AssetLibrary,
  type ThemeId,
} from './assets.ts';
import { officePresets } from './office-presets.ts';
import type { Draft } from './draft.ts';

const packIds: Record<ThemeId, string> = {
  holz: '42612c0c-1580-4bfb-b954-207a7a4a10b1',
  garten: '42612c0c-1580-4bfb-b954-207a7a4a10b2',
  abend: '42612c0c-1580-4bfb-b954-207a7a4a10b3',
};

/** Das bestehende Importformat erlaubt ausschließlich config.json und assets/. */
export function packConfig(theme: ThemeId, assets: AssetLibrary) {
  const base = (id: AssetId) => ({
    id: `atelier_${theme}_${id}`,
    key: assetDefinitions[id].name,
    dataURL: `assets/${id}.png`,
    collide: assetDefinitions[id].collisionBaseRows > 0,
    scaleFactor: 1,
    collisionBaseHeight: assetDefinitions[id].collisionBaseRows,
    rotationAllowed: Object.hasOwn(directionalAssets, id),
    flipAllowed: false,
  });
  return {
    uuid: packIds[theme],
    name: `Atelier · ${themes[theme].name}`,
    version: '0.4.0',
    author: 'Meetropolis',
    description:
      'Eigene Pixelvorlagen aus dem Meetropolis Asset-Atelier, MIT-Lizenz. Lizenzhinweise im Entwurfsexport und unter tools/asset-lab/LICENSE.',
    terrain: (['floor', 'carpet'] as const).map((id) => ({
      ...base(id),
      category: 'terrain',
      placement: 'floor',
      renderLayer: 'floor',
      tileWidth: assets[id].width,
      tileHeight: assets[id].height,
      margin: 0,
      spacing: 0,
    })),
    structures: (['window', 'wall', 'door', 'door_open'] as const).map((id) => ({
      ...base(id),
      category: 'structure',
      placement: 'wall',
      renderLayer: 'sorted',
      width: assets[id].width,
      height: assets[id].height,
    })),
    objects: (Object.keys(assets) as AssetId[])
      .filter((id) => !['floor', 'carpet', 'window', 'wall', 'door', 'door_open', 'wall_set'].includes(id))
      .map((id) => ({
        ...base(id),
        category: 'objects',
        placement: 'floor',
        renderLayer: 'sorted',
        width: assets[id].width,
        height: assets[id].height,
        ...(Object.hasOwn(directionalAssets, id)
          ? {
              directionalImages: Object.entries(directionalAssets[id as keyof typeof directionalAssets]).map(
                ([rotation, variant]) => ({
                  rotation: Number(rotation),
                  dataURL: `assets/${variant}.png`,
                }),
              ),
            }
          : {}),
      })),
    autotiles: [
      {
        id: `atelier_${theme}_wall_set`,
        key: 'Anschließbare Wände',
        category: 'autotile',
        dataURL: 'assets/wall_set.png',
        placement: 'wall',
        collide: true,
        tileWidth: 16,
        tileHeight: 48,
        gridHeight: 3,
        autotileType: '4bit',
        scaleFactor: 1,
        variants: Object.fromEntries(
          Array.from({ length: 16 }, (_, mask) => [String(mask), { col: mask % 4, row: Math.floor(mask / 4) }]),
        ),
      },
    ],
  };
}

export function officeRecipe(draft: Pick<Draft, 'theme' | 'office'>) {
  const office = officePresets[draft.office];
  return {
    schema: 'meetropolis-office-study/v2',
    ...office,
    theme: draft.theme,
    note: 'Lokale Raumstudie. Das Rezept ist noch kein Importformat des produktiven Map-Editors. Die Zonen sind räumliche Vorschläge ohne Audiofunktion.',
  };
}

export async function packZip(
  theme: ThemeId,
  assets: AssetLibrary,
  encode: (id: AssetId) => Uint8Array | Promise<Uint8Array>,
): Promise<Uint8Array> {
  const zip = new JSZip();
  const options = {
    date: new Date('2026-09-07T00:00:00Z'),
    createFolders: false,
  };
  zip.file('config.json', JSON.stringify(packConfig(theme, assets), null, 2), options);
  for (const id of Object.keys(assets) as AssetId[]) zip.file(`assets/${id}.png`, await encode(id), options);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
