import React from 'react';
import { TilesetPreview, Button } from '../../ui/components';
import type { EditorState, EditorCategory, EditorTool } from '../../hooks/useEditor';

export function EditorPanel(props: {
  editor: EditorState;
  setEditor: React.Dispatch<React.SetStateAction<EditorState>>;
  onOpenUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const { editor, setEditor } = props;
  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setEditor(s => ({ ...s, tool: 'select' }))} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: editor.tool==='select'?'rgba(59,130,246,0.2)':'rgba(255,255,255,0.05)', color: editor.tool==='select'?'#60a5fa':'#e5e7eb', fontSize: 13 }}>Auswählen</button>
        <button onClick={() => setEditor(s => ({ ...s, tool: 'erase' }))} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: editor.tool==='erase'?'rgba(239,68,68,0.2)':'rgba(255,255,255,0.05)', color: editor.tool==='erase'?'#f87171':'#e5e7eb', fontSize: 13 }}>Löschen</button>
      </div>

      {editor.category === 'terrain' && (
        <>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>Terrain-Werkzeuge</div>
            <div style={{ display: 'grid', grid: 'auto / 1fr 1fr', gap: 6 }}>
              <button onClick={() => setEditor(s => ({ ...s, tool: 'floor' }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: editor.tool==='floor'?'rgba(34,197,94,0.2)':'rgba(255,255,255,0.05)', color: editor.tool==='floor'?'#4ade80':'#e5e7eb', fontSize: 13 }}>🏠 Boden</button>
              <button onClick={() => setEditor(s => ({ ...s, tool: 'collision' }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: editor.tool==='collision'?'rgba(239,68,68,0.2)':'rgba(255,255,255,0.05)', color: editor.tool==='collision'?'#f87171':'#e5e7eb', fontSize: 13 }}>🚫 Kollision</button>
            </div>
          </div>

          {editor.tool === 'floor' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#9ca3af' }}>Bodentextur auswählen</div>
              {editor.tilePaint && editor.tilesets && editor.tilesets.length > 0 && (
                <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 8 }}>
                  {editor.tilesets.filter(ts => !ts.category || ts.category === 'terrain').map(lib => (
                    <div key={lib.key} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{lib.key}</div>
                      <TilesetPreview tileset={lib} selectedIndex={editor.tilePaint?.tilesetKey === lib.key ? editor.tilePaint.tileIndex : -1} onSelect={(index: number) => setEditor(s => ({ ...s, tilePaint: { tilesetKey: lib.key, tileIndex: index, tileWidth: lib.tileWidth, tileHeight: lib.tileHeight, margin: lib.margin, spacing: lib.spacing } }))} />
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#6b7280' }}>Ziehe mit der Maus um Boden zu malen</div>
            </div>
          )}
        </>
      )}

      {editor.category === 'zones' && (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>Zonen-Verwaltung</div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#9ca3af' }}>Zonenname</label>
            <input value={editor.name} onChange={(e)=>setEditor(s=>({ ...s, name: e.target.value }))} placeholder="z.B. Meeting Room A" style={{ padding: 8, borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13 }} />
          </div>
        </>
      )}

      {(editor.category === 'terrain' || editor.category === 'structures' || editor.category === 'objects') && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12, marginTop: 12 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>Tileset hochladen</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.1)', cursor: 'pointer' }}>
              <label style={{ cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center', gap: 8, color: '#93bbfe' }}>
                <span style={{ fontSize: 16 }}>📁</span>
                <span style={{ fontSize: 13 }}>Tileset-Bild auswählen...</span>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={props.onOpenUpload} />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


