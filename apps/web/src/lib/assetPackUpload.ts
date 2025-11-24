/**
 * AssetPack Upload Utility
 * 
 * Erstellt aus Tilesets/Objects ein vollständiges AssetPack-ZIP
 * und lädt es zum Server hoch für persistente Speicherung.
 */

import JSZip from 'jszip';

export type TilesetData = {
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin?: number;
  spacing?: number;
  category?: 'terrain' | 'structures' | 'objects';
};

/**
 * Konvertiert Base64 data URL zu Blob
 */
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

/**
 * Generiert eine UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Erstellt ein AssetPack-ZIP aus einem Tileset und lädt es hoch
 */
export async function uploadTilesetAsAssetPack(
  tileset: TilesetData,
  apiBase: string
): Promise<{ success: boolean; uuid?: string; error?: string }> {
  try {
    // 1. ZIP erstellen
    const zip = new JSZip();
    
    // 2. AssetPack UUID generieren (muss gültige UUID v4 sein!)
    const uuid = generateUUID();
    
    // 3. config.json erstellen (Server erwartet "config.json", nicht "asset-pack.json"!)
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
          category: 'terrain' as const, // PFLICHTFELD für Schema-Validierung
          dataURL: `assets/tilesets/${tileset.key}.png`, // WICHTIG: "assets/" prefix und "dataURL" (nicht "image")!
          tileWidth: tileset.tileWidth,
          tileHeight: tileset.tileHeight,
          margin: tileset.margin || 0,
          spacing: tileset.spacing || 0,
        }
      ],
      structures: [],
      objects: []
    };
    
    zip.file('config.json', JSON.stringify(config, null, 2));
    
    // 4. Bild-Datei hinzufügen (WICHTIG: "assets/" prefix!)
    const imageBlob = dataUrlToBlob(tileset.dataUrl);
    zip.file(`assets/tilesets/${tileset.key}.png`, imageBlob);
    
    // 5. ZIP als Blob generieren
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    // 6. FormData für Upload erstellen
    const formData = new FormData();
    formData.append('file', zipBlob, `${uuid}.zip`);
    
    // 7. Upload zum Server
    const response = await fetch(`${apiBase}/asset-packs/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    
    if (!response.ok) {
      const text = await response.text();
      let errorMsg = `Upload failed: ${response.status}`;
      try {
        const json = JSON.parse(text);
        errorMsg = json.error || errorMsg;
      } catch {
        // Ignore parse error
      }
      return { success: false, error: errorMsg };
    }
    
    const result = await response.json();
    return { success: true, uuid: result.uuid };
    
  } catch (e: any) {
    console.error('[AssetPackUpload] Failed:', e);
    return { success: false, error: e.message || String(e) };
  }
}

