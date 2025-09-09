import React from 'react';
import { TilesetPreview, Button } from '../../ui/components';
import type { EditorState, EditorCategory, EditorTool } from '../../hooks/useEditor';
import { gameBridge } from '../../game/bridge';

export function EditorPanel(props: {
  editor: EditorState;
  setEditor: React.Dispatch<React.SetStateAction<EditorState>>;
  onOpenUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const { editor, setEditor } = props;
  React.useEffect(() => {
    // Activate editor mode for scene interactions
    try { gameBridge.setEditorMode(true); } catch {}
    return () => { try { gameBridge.setEditorMode(false); } catch {} };
  }, []);
  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setEditor(s => ({ ...s, tool: 'select' }))} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editor.tool==='select'?'rgba(59,130,246,0.18)':'var(--glass)', color: 'var(--fg)', fontSize: 13 }}>Auswählen</button>
        <button onClick={() => setEditor(s => ({ ...s, tool: 'erase' }))} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editor.tool==='erase'?'rgba(239,68,68,0.18)':'var(--glass)', color: 'var(--fg)', fontSize: 13 }}>Löschen</button>
      </div>

      {editor.category === 'terrain' && (
        <>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Terrain-Werkzeuge</div>
            <div style={{ display: 'grid', grid: 'auto / 1fr 1fr', gap: 6 }}>
              <button onClick={() => setEditor(s => ({ ...s, tool: 'floor' }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editor.tool==='floor'?'rgba(34,197,94,0.18)':'var(--glass)', color: 'var(--fg)', fontSize: 13 }}>🏠 Boden</button>
              <button onClick={() => setEditor(s => ({ ...s, tool: 'collision' }))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editor.tool==='collision'?'rgba(239,68,68,0.18)':'var(--glass)', color: 'var(--fg)', fontSize: 13 }}>🚫 Kollision</button>
            </div>
          </div>

          {editor.tool === 'floor' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-subtle)' }}>Bodentextur auswählen</div>
              {editor.tilePaint && editor.tilesets && editor.tilesets.length > 0 && (
                <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8, background: 'var(--glass)' }}>
                  {editor.tilesets.filter(ts => !ts.category || ts.category === 'terrain').map(lib => (
                    <div key={lib.key} style={{ marginBottom: 8 }}>
                       <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginBottom: 4 }}>{lib.key}</div>
                      <TilesetPreview tileset={lib} selectedIndex={editor.tilePaint?.tilesetKey === lib.key ? editor.tilePaint.tileIndex : -1} onSelect={(index: number) => setEditor(s => ({ ...s, tilePaint: { tilesetKey: lib.key, tileIndex: index, tileWidth: lib.tileWidth, tileHeight: lib.tileHeight, margin: lib.margin, spacing: lib.spacing } }))} />
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>Ziehe mit der Maus um Boden zu malen</div>
            </div>
          )}
        </>
      )}

      {editor.category === 'zones' && (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Zonen-Verwaltung</div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Zonenname</label>
            <input value={editor.name} onChange={(e)=>setEditor(s=>({ ...s, name: e.target.value }))} placeholder="z.B. Meeting Room A" style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', fontSize: 13 }} />
          </div>
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Vorhandene Zonen</div>
            {editor.zones.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Noch keine Zonen. Ziehe auf der Karte einen Bereich, um eine Zone zu erstellen.</div>
            )}
            {editor.zones.map((z, idx) => (
              <div key={idx} style={{ display: 'grid', gap: 6, padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: editor.editingZoneIndex===idx? 'rgba(59,130,246,0.08)' : 'var(--glass)' }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>Name</label>
                  <input
                    value={z.name}
                    onChange={(e)=>setEditor(s=>{
                      const zones = s.zones.slice();
                      zones[idx] = { ...zones[idx], name: e.target.value };
                      return { ...s, zones };
                    })}
                    style={{ padding: 6, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', fontSize: 12 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={()=>setEditor(s=>({ ...s, editingZoneIndex: idx, tool: 'zone', category: 'zones', name: s.zones[idx]?.name || '' }))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', fontSize: 12 }}>Neu ziehen</button>
                  <button onClick={()=>setEditor(s=>{
                    const zones = s.zones.filter((_,i)=>i!==idx);
                    // Wenn gerade bearbeitet wird und diese Zone entfernt wird, Bearbeitung zurücksetzen
                    const editing = (s.editingZoneIndex ?? null) === idx ? null : s.editingZoneIndex;
                    // Persistiere nach LocalStorage
                    try { localStorage.setItem('meetropolis.zones', JSON.stringify(zones)); } catch {}
                    // Szene-Overlay aktualisieren, falls verfügbar
                    try { (window as any).currentPhaserScene?.setZoneOverlay?.(zones); } catch {}
                    // Best-effort Server speichern
                    (async ()=>{
                      try {
                        const base = (window as any).VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2568`;
                        const body = JSON.stringify({ zones });
                        if (body.length < 100000) {
                          await fetch(`${base}/maps/office/editor-state`, {
                            method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body
                          });
                        }
                      } catch {}
                    })();
                    return { ...s, zones, editingZoneIndex: editing };
                  })} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(239,68,68,0.12)', color: 'var(--fg)', fontSize: 12 }}>Löschen</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {(editor.category === 'terrain' || editor.category === 'structures' || editor.category === 'objects') && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Tileset hochladen</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', cursor: 'pointer' }}>
              <label style={{ cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg)' }}>
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


