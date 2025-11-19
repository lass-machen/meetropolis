import React from 'react';
import { Checkbox } from '../../ui/system';
import type { EditorState } from '../../hooks/useEditor';
import { gameBridge } from '../../game/bridge';
import { logger } from '../../lib/logger';
import { useEditorBridge } from '../../editor/useEditorBridge';
import { Toast } from '../../ui/system';
import { useTranslation } from 'react-i18next';

export function EditorPanel(props: {
  editor: EditorState;
  setEditor: React.Dispatch<React.SetStateAction<EditorState>>;
  onOpenUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSave?: () => Promise<boolean> | void;
  onSaveEditor?: () => Promise<boolean> | void; // alias to avoid prop name collisions in some callsites
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { editor, setEditor } = props;
  const { t } = useTranslation();
  // Bind editor-pointer bridge so scene events reach the editor tools (including spawn)
  useEditorBridge({ editor, setEditor, gameBridge });
  React.useEffect(() => {
    // Activate editor mode for scene interactions
    try { gameBridge.setEditorMode(true); } catch (e) { logger.error('Failed to enable editor mode', e); }
    // Aktivieren des Editor-States und Standardkategorie Terrain
    setEditor(s => ({ ...s, active: true, category: 'terrain', tool: s.tool === 'terrain' ? s.tool : 'terrain' }));
    return () => { try { gameBridge.setEditorMode(false); } catch (e) { logger.error('Failed to disable editor mode', e); } };
  }, []);

  // Höre auf Tileset-Konfiguration (Modal bestätigt): Atlas in Items aufteilen
  React.useEffect(() => {
    const onTilesetConfirm = (e: any) => {
      try {
        const ts = (e as CustomEvent)?.detail as any;
        if (!ts || !ts.dataUrl || !ts.tileWidth || !ts.tileHeight) return;
        const category = (ts.category === 'structures' || ts.category === 'objects') ? ts.category : 'terrain';
        const img = new Image();
        img.onload = () => {
          try {
            const margin = ts.margin || 0;
            const spacing = ts.spacing || 0;
            const cols = Math.max(1, Math.floor((img.width - margin + spacing) / (ts.tileWidth + spacing)));
            const rows = Math.max(1, Math.floor((img.height - margin + spacing) / (ts.tileHeight + spacing)));
            const items: any[] = [];
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            canvas.width = ts.tileWidth;
            canvas.height = ts.tileHeight;
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                const sx = margin + c * (ts.tileWidth + spacing);
                const sy = margin + r * (ts.tileHeight + spacing);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, sx, sy, ts.tileWidth, ts.tileHeight, 0, 0, ts.tileWidth, ts.tileHeight);
                const url = canvas.toDataURL('image/png');
                const itemId = `${ts.key}:${r}:${c}`;
                items.push({ packUuid: 'local:tileset', itemId, key: `${ts.key}-${r}-${c}`, category, dataUrl: url, width: ts.tileWidth, height: ts.tileHeight, collide: false });
              }
            }
            setEditor(s => {
              const prev = Array.isArray(s.packItems) ? s.packItems.slice() : [];
              const combined = prev.concat(items);
              const seen = new Set<string>();
              const unique: any[] = [];
              for (const it of combined) {
                const k = `${it.packUuid}:${it.itemId}`;
                if (seen.has(k)) continue;
                seen.add(k);
                unique.push(it);
              }
              // LocalStorage sync for custom palette items (client-side preference)
              try { localStorage.setItem('meetropolis.packItems', JSON.stringify(unique)); } catch (e) { logger.warn('Failed to save packItems to localStorage', e); }
              return { ...s, packItems: unique } as any;
            });
          } catch (e) { logger.error('Failed to slice tileset', e); }
        };
        img.src = ts.dataUrl;
      } catch (e) { logger.error('Failed to process tileset confirmation', e); }
    };
    window.addEventListener('editor:tileset-confirm', onTilesetConfirm as any);
    return () => { window.removeEventListener('editor:tileset-confirm', onTilesetConfirm as any); };
  }, [setEditor]);
  
  const [saving, setSaving] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [lastChangeAt, setLastChangeAt] = React.useState<number | null>(null);
  React.useEffect(() => {
    const dirty = !!(lastChangeAt && (!lastSavedAt || lastChangeAt > lastSavedAt));
    props.onDirtyChange?.(dirty);
  }, [lastChangeAt, lastSavedAt, props.onDirtyChange]);
  const [toastOpen, setToastOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{ title?: string; description?: string; intent?: 'info' | 'success' | 'error' }>({});
  const [zonesVisible, setZonesVisible] = React.useState(true);

  const handleSaveClick = React.useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const saveHandler = props.onSave || props.onSaveEditor;
      const result = await saveHandler?.();
      const ok = typeof result === 'boolean' ? result : true;
      if (ok) {
        setLastSavedAt(Date.now());
        setToast({ title: t('editor.savedTitle'), description: t('editor.changesSaved'), intent: 'success' });
        setToastOpen(true);
      } else {
        setToast({ title: t('editor.saveFailedTitle'), description: t('editor.saveFailedDesc'), intent: 'error' });
        setToastOpen(true);
      }
    } catch (e: any) {
      logger.error('Failed to save editor changes', e);
      setToast({ title: t('editor.saveFailedTitle'), description: (e?.message || t('common.error')).toString(), intent: 'error' });
      setToastOpen(true);
    } finally {
      setSaving(false);
    }
  }, [props.onSave, saving]);

  const lastSavedLabel = React.useMemo(() => {
    if (!lastSavedAt) return null;
    const dt = new Date(lastSavedAt);
    const hh = dt.getHours().toString().padStart(2, '0');
    const mm = dt.getMinutes().toString().padStart(2, '0');
    const ss = dt.getSeconds().toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }, [lastSavedAt]);

  // Overlay Toggle anwenden
  React.useEffect(() => {
    try {
      gameBridge.setZonesVisible(zonesVisible);
      if (zonesVisible) {
        gameBridge.setZoneOverlay(props.editor.zones || []);
      }
    } catch (e) { logger.error('Failed to toggle zone overlay', e); }
  }, [zonesVisible, props.editor.zones]);

  // Globale Editor-Toast Events empfangen (z. B. Fehlermeldungen aus App.tsx)
  React.useEffect(() => {
    const onToast = (e: any) => {
      try {
        const d = (e as CustomEvent)?.detail || {};
        setToast({ title: d.title, description: d.description, intent: d.intent });
        setToastOpen(true);
      } catch (e) { logger.error('Failed to process editor toast', e); }
    };
    window.addEventListener('editor:toast', onToast as any);
    return () => { window.removeEventListener('editor:toast', onToast as any); };
  }, []);

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.background')}</div>
        <input
          type="color"
          value={editor.backgroundColor}
          onChange={(e)=> {
            const color = e.target.value;
            setEditor(s => ({ ...s, backgroundColor: color }));
            try { gameBridge.setBackgroundColor(color); } catch (e) { logger.error('Failed to set background color in game', e); }
            // Keine Autospeicherung – Speichern-Button verwenden
            setLastChangeAt(Date.now());
          }}
          style={{ width: 48, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'transparent' }}
        />
      </div>
      {/* Spawnpunkt setzen (Modus: Button → Klick in Map) */}
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Spawnpunkt</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!editor.settingSpawn ? (
            <button
              onClick={() => {
                try { console.log('[SPAWN_DBG] EditorPanel: enable settingSpawn'); } catch (e) { logger.error('Spawn log failed', e); }
                setEditor(s => ({ ...s, settingSpawn: true }));
                setToast({ title: 'Spawn setzen', description: 'Klicke in die Map, um den Spawnpunkt zu wählen.', intent: 'info' });
                setToastOpen(true);
              }}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', fontSize: 13 }}
            >
              Spawn setzen
            </button>
          ) : (
            <button
              onClick={() => { try { console.log('[SPAWN_DBG] EditorPanel: cancel settingSpawn'); } catch (e) { logger.error('Spawn log failed', e); }; setEditor(s => ({ ...s, settingSpawn: false })); }}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(239,68,68,0.12)', color: 'var(--fg)', fontSize: 13 }}
            >
              Abbrechen
            </button>
          )}
          <button
            onClick={() => {
              try { gameBridge.setSpawnMarker(null); } catch (e) { logger.error('Failed to clear spawn marker', e); }
              setEditor(s => ({ ...s, spawn: null }));
              setToast({ title: 'Spawn entfernt', description: 'Der Spawnpunkt wurde zurückgesetzt.', intent: 'info' });
              setToastOpen(true);
              setLastChangeAt(Date.now());
            }}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', fontSize: 13 }}
          >
            Entfernen
          </button>
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
            {editor.spawn ? `Aktueller Spawn: (${Math.round(editor.spawn.x)}, ${Math.round(editor.spawn.y)})` : 'Kein Spawn gesetzt'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {editor.category !== 'terrain' && (
          <button onClick={() => setEditor(s => ({ ...s, tool: 'select' }))} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editor.tool==='select'?'rgba(59,130,246,0.18)':'var(--glass)', color: 'var(--fg)', fontSize: 13 }}>{t('editor.select')}</button>
        )}
        {editor.category === 'terrain' ? (
          <>
            <button onClick={() => {
              setEditor(s => ({ ...s, tool: 'collision' }));
              try { (window as any).currentPhaserScene?.setEditorTool?.('collision'); } catch (e) { logger.error('Failed to set editor tool collision', e); }
            }} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editor.tool==='collision'?'rgba(239,68,68,0.18)':'var(--glass)', color: 'var(--fg)', fontSize: 13 }}>{t('editor.collision')}</button>
            <button onClick={() => {
              setEditor(s => ({ ...s, tool: 'erase' }));
              try { (window as any).currentPhaserScene?.setEditorTool?.('erase'); } catch (e) { logger.error('Failed to set editor tool erase', e); }
            }} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editor.tool==='erase'?'rgba(239,68,68,0.18)':'var(--glass)', color: 'var(--fg)', fontSize: 13 }}>{t('editor.delete')}</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditor(s => ({ ...s, tool: 'collision' }))} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editor.tool==='collision'?'rgba(239,68,68,0.18)':'var(--glass)', color: 'var(--fg)', fontSize: 13 }}>{t('editor.collision')}</button>
            <button onClick={() => setEditor(s => ({ ...s, tool: 'erase' }))} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editor.tool==='erase'?'rgba(239,68,68,0.18)':'var(--glass)', color: 'var(--fg)', fontSize: 13 }}>{t('editor.delete')}</button>
          </>
        )}
      </div>

      {editor.category === 'terrain' && (
        <>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('editor.terrain')}</div>
            {(!editor.packItems || editor.packItems.filter(it=>it.category==='terrain').length === 0) && (
              <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.noTerrain')}</div>
            )}
            {editor.packItems && editor.packItems.filter(it=>it.category==='terrain').length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8, maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--glass)', padding: 8 }}>
                {editor.packItems.filter(it => it.category === 'terrain').map(it => {
                  const selected = !!editor.pendingTerrain && editor.pendingTerrain.itemId === it.itemId && editor.pendingTerrain.packUuid === it.packUuid;
                  return (
                    <button key={`${it.packUuid}:${it.itemId}`}
                      onClick={() => {
                        // Behandle Terrain-Items wie Objekte: platziere als Asset (wie zuvor)
                        setEditor(s => ({
                          ...s,
                          tool: 'asset',
                          pendingAsset: {
                            key: it.key,
                            dataUrl: it.dataUrl,
                            packUuid: it.packUuid,
                            itemId: it.itemId,
                            category: 'terrain',
                            collide: false,
                            width: it.width,
                            height: it.height,
                          }
                        }));
                        try { (window as any).currentPhaserScene?.setAssetPreview?.({ dataUrl: it.dataUrl, width: it.width, height: it.height }); } catch (e) { logger.error('Failed to set asset preview', e); }
                      }}
                      title={it.key}
                      style={{
                        padding: 4,
                        borderRadius: 8,
                        border: `1px solid ${selected ? 'rgba(34,197,94,0.8)' : 'var(--border)'}`,
                        background: selected ? 'rgba(34,197,94,0.12)' : 'var(--glass)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: 64,
                        cursor: 'pointer'
                      }}
                    >
                      <img src={it.dataUrl} alt={it.key} style={{ maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' as any }} />
                    </button>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{t('editor.hintTerrain')}</div>
          </div>
        </>
      )}

      {editor.category === 'zones' && (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('editor.zones')}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.zoneName')}</label>
            <input value={editor.name} onChange={(e)=>setEditor(s=>({ ...s, name: e.target.value }))} placeholder={t('editor.exampleRoomName')} style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', fontSize: 13 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={()=>{
                // Starte neuen Zonen-Zeichenvorgang
                setEditor(s=>({ ...s, tool: 'zone', category: 'zones', editingZoneIndex: null }));
                try { (window as any).currentPhaserScene?.setSelectionRect?.(null); } catch (e) { logger.error('Failed to clear selection rect', e); }
              }} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: editor.tool==='zone'?'rgba(59,130,246,0.18)':'var(--glass)', color: 'var(--fg)', fontSize: 13 }}>{t('editor.drawNew')}</button>
              <button onClick={()=>{
                setEditor(s=>({ ...s, tool: 'select', editingZoneIndex: null }));
                try { (window as any).currentPhaserScene?.setSelectionRect?.(null); } catch (e) { logger.error('Failed to clear selection rect', e); }
              }} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', fontSize: 13 }}>{t('editor.cancel')}</button>
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.existingZones')}</div>
            {editor.zones.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.noZones')}</div>
            )}
            {editor.zones.map((z, idx) => (
              <div key={idx} style={{ display: 'grid', gap: 6, padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: editor.editingZoneIndex===idx? 'rgba(59,130,246,0.08)' : 'var(--glass)' }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{t('editor.name')}</label>
                  <input
                    value={z.name}
                    onChange={(e)=>{ setEditor(s=>{
                      const zones = s.zones.slice();
                      zones[idx] = { ...zones[idx], name: e.target.value };
                      return { ...s, zones } as any;
                    }); setLastChangeAt(Date.now()); }}
                    style={{ padding: 6, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', fontSize: 12 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={()=>setEditor(s=>({ ...s, editingZoneIndex: idx, tool: 'zone', category: 'zones', name: s.zones[idx]?.name || '' }))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', fontSize: 12 }}>{t('editor.drawNew')}</button>
                  <button onClick={()=>setEditor(s=>{
                    const zones = s.zones.filter((_,i)=>i!==idx);
                    // Wenn gerade bearbeitet wird und diese Zone entfernt wird, Bearbeitung zurücksetzen
                    const editing = (s.editingZoneIndex ?? null) === idx ? null : (s.editingZoneIndex ?? null);
                    // Szene-Overlay aktualisieren, falls verfügbar
                    try { (window as any).currentPhaserScene?.setZoneOverlay?.(zones); } catch (e) { logger.error('Failed to set zone overlay', e); }
                    // Keine Autospeicherung – Speichern-Button verwenden
                    setLastChangeAt(Date.now());
                    return { ...s, zones, editingZoneIndex: editing };
                  })} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(239,68,68,0.12)', color: 'var(--fg)', fontSize: 12 }}>{t('editor.remove')}</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {(editor.category === 'terrain' || editor.category === 'structures' || editor.category === 'objects') && (
        <>
          {editor.category !== 'terrain' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('editor.packs')}</div>
              {(() => {
                const list = (editor.packItems || []).filter(it => it.category === editor.category);
                if (!editor.packItems || list.length === 0) {
                  return <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.noPacks')}</div>;
                }
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8, maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--glass)', padding: 8 }}>
                    {list.map(it => {
                      const selected = !!editor.pendingAsset && editor.pendingAsset.itemId === it.itemId && editor.pendingAsset.packUuid === it.packUuid;
                      return (
                        <button key={`${it.packUuid}:${it.itemId}`}
                          onClick={() => {
                            setEditor(s => ({
                              ...s,
                              tool: 'asset',
                              pendingAsset: {
                                key: it.key,
                                dataUrl: it.dataUrl,
                                packUuid: it.packUuid,
                                itemId: it.itemId,
                                category: it.category as 'structures' | 'objects',
                                collide: it.collide,
                                width: it.width,
                                height: it.height,
                              }
                            }));
                            try { (window as any).currentPhaserScene?.setAssetPreview?.({ dataUrl: it.dataUrl, width: it.width, height: it.height }); } catch (e) { logger.error('Failed to set asset preview', e); }
                          }}
                          title={it.key}
                          style={{
                            padding: 4,
                            borderRadius: 8,
                            border: `1px solid ${selected ? 'rgba(59,130,246,0.8)' : 'var(--border)'}`,
                            background: selected ? 'rgba(59,130,246,0.12)' : 'var(--glass)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: 64,
                            cursor: 'pointer'
                          }}
                        >
                          <img src={it.dataUrl} alt={it.key} style={{ maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' as any }} />
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
              <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{t('editor.placeHint')}</div>
            </div>
          )}
        </>
      )}

      {/* Footer mit Speichern-Button und Overlay-Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
          {lastSavedLabel ? t('editor.lastSaved', { time: lastSavedLabel }) : t('editor.notSaved')}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-subtle)' }}>
          <Checkbox checked={zonesVisible} onChange={e => setZonesVisible((e.target as HTMLInputElement).checked)} /> {t('editor.showZones')}
        </label>
        <button onClick={handleSaveClick} disabled={saving} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(59,130,246,0.18)', color: 'var(--fg)', fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1, cursor: saving ? 'default' : 'pointer' }}>
          {saving ? t('editor.saving') : t('editor.save')}
        </button>
      </div>

      {(editor.category === 'terrain' || editor.category === 'structures' || editor.category === 'objects') && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('editor.uploadTileset')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', cursor: 'pointer' }}>
              <label style={{ cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg)' }}>
                <span style={{ fontSize: 16 }}>📁</span>
                <span style={{ fontSize: 13 }}>{t('editor.chooseImage')}</span>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    try {
                      const f = (e.target as HTMLInputElement).files?.[0];
                      if (f) logger.debug('[ASSETS_DBG] image selected', { name: f.name, size: f.size, type: f.type });
                    } catch (e) { logger.error('Failed to debug image selection', e); }
                    try { logger.debug('[ASSETS_DBG] calling onOpenUpload'); } catch (e) { logger.error('Failed to debug log', e); }
                    props.onOpenUpload(e);
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}
      <Toast open={toastOpen} onOpenChange={setToastOpen} title={toast.title || ''} description={toast.description || ''} intent={toast.intent || 'info'} />
    </div>
  );
}


