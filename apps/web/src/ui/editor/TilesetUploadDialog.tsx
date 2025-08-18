import React from 'react';
import { Modal, Button, TilesetPreview } from '../../ui/components';

export type UploadDialogState = {
  open: boolean;
  dataUrl: string;
  fileName: string;
  tileWidth: number;
  tileHeight: number;
  margin: number;
  spacing: number;
  category?: 'terrain' | 'structures' | 'objects';
};

export function TilesetUploadDialog(props: {
  open: boolean;
  dialog: UploadDialogState;
  onCancel: () => void;
  onConfirm: (tileset: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin: number; spacing: number; category?: 'terrain' | 'structures' | 'objects' }) => void;
  setDialog: (next: UploadDialogState | null) => void;
}) {
  if (!props.open) return null;

  const d = props.dialog;
  const previewTileset = { key: 'uploading', dataUrl: d.dataUrl, tileWidth: d.tileWidth, tileHeight: d.tileHeight, margin: d.margin, spacing: d.spacing };

  return (
    <Modal
      open={true}
      title={`Tileset konfigurieren: ${d.fileName}`}
      onClose={props.onCancel}
      maxWidth={800}
      footer={(
        <>
          <Button variant="ghost" onClick={props.onCancel}>Abbrechen</Button>
          <Button variant="primary" onClick={() => {
            const tileset = {
              key: `tileset-${Date.now()}`,
              dataUrl: d.dataUrl,
              tileWidth: d.tileWidth,
              tileHeight: d.tileHeight,
              margin: d.margin,
              spacing: d.spacing,
              category: d.category
            } as const;
            props.onConfirm(tileset);
          }}>Tileset hinzufügen</Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb', marginBottom: 8 }}>Vorschau</div>
            <div style={{ maxHeight: 400, overflow: 'auto', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, background: 'rgba(0,0,0,0.3)', padding: 16 }}>
              <TilesetPreview tileset={previewTileset} selectedIndex={-1} onSelect={() => {}} />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>Tile-Einstellungen</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#9ca3af' }}>Tile-Breite (px)</label>
              <input type="number" min={8} max={256} value={d.tileWidth} onChange={(e) => props.setDialog({ ...d, tileWidth: parseInt(e.target.value) || 16 })} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13 }} />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#9ca3af' }}>Tile-Höhe (px)</label>
              <input type="number" min={8} max={256} value={d.tileHeight} onChange={(e) => props.setDialog({ ...d, tileHeight: parseInt(e.target.value) || 16 })} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13 }} />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#9ca3af' }}>Rand (px)</label>
              <input type="number" min={0} max={64} value={d.margin} onChange={(e) => props.setDialog({ ...d, margin: parseInt(e.target.value) || 0 })} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13 }} />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#9ca3af' }}>Abstand zwischen Tiles (px)</label>
              <input type="number" min={0} max={64} value={d.spacing} onChange={(e) => props.setDialog({ ...d, spacing: parseInt(e.target.value) || 0 })} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13 }} />
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>Passe die Werte an, bis die Tiles korrekt getrennt sind. Typische Werte: 16x16, 32x32 oder 64x64 Pixel pro Tile.</div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              <label style={{ fontSize: 12, color: '#9ca3af' }}>Kategorie</label>
              <select value={d.category || 'terrain'} onChange={(e) => props.setDialog({ ...d, category: e.target.value as any })} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13 }}>
                <option value="terrain">Terrain (Böden)</option>
                <option value="structures">Strukturen (Wände)</option>
                <option value="objects">Objekte (Möbel)</option>
              </select>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Wähle die passende Kategorie für dieses Tileset.</div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}


