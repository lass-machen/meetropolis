/**
 * AssetPack upload utility.
 *
 * Builds a complete AssetPack ZIP from tilesets/objects and uploads it to
 * the server for persistent storage.
 */

import JSZip from 'jszip';
import { logger } from './logger';

export type TilesetData = {
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin?: number;
  spacing?: number;
  category?: 'terrain' | 'structures' | 'objects';
};

/** Convert a base64 data URL to a Blob. */
function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/** Generate a UUID v4 string. */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Build an AssetPack ZIP from a tileset and upload it to the server. */
export async function uploadTilesetAsAssetPack(
  tileset: TilesetData,
  apiBase: string,
): Promise<{ success: boolean; uuid?: string; error?: string }> {
  try {
    // 1. Create the ZIP container.
    const zip = new JSZip();

    // 2. Generate the AssetPack UUID (must be a valid UUID v4).
    const uuid = generateUUID();

    // 3. Build config.json (server expects "config.json", not "asset-pack.json").
    const config = {
      uuid,
      name: `Custom Tileset (${tileset.key})`,
      description: 'User-uploaded tileset from editor',
      author: 'User',
      version: '1.0.0',
      terrain: [
        {
          id: tileset.key,
          key: tileset.key,
          category: 'terrain' as const, // Required by the schema validator.
          dataURL: `assets/tilesets/${tileset.key}.png`, // Must use the "assets/" prefix and "dataURL" (not "image").
          tileWidth: tileset.tileWidth,
          tileHeight: tileset.tileHeight,
          margin: tileset.margin || 0,
          spacing: tileset.spacing || 0,
        },
      ],
      structures: [],
      objects: [],
    };

    zip.file('config.json', JSON.stringify(config, null, 2));

    // 4. Add the image file (path must include the "assets/" prefix).
    const imageBlob = dataUrlToBlob(tileset.dataUrl);
    zip.file(`assets/tilesets/${tileset.key}.png`, imageBlob);

    // 5. Serialise the ZIP as a Blob.
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    // 6. Build the multipart form data for the upload.
    const formData = new FormData();
    formData.append('file', zipBlob, `${uuid}.zip`);

    // 7. POST the archive to the server.
    const response = await fetch(`${apiBase}/asset-packs/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMsg = `Upload failed: ${response.status}`;
      try {
        const json = JSON.parse(text) as { error?: string };
        errorMsg = json.error || errorMsg;
      } catch {
        // Ignore parse error
      }
      return { success: false, error: errorMsg };
    }

    const result = (await response.json()) as { uuid?: string };
    return result.uuid ? { success: true, uuid: result.uuid } : { success: true };
  } catch (e: unknown) {
    logger.error('[AssetPackUpload] Failed:', e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
