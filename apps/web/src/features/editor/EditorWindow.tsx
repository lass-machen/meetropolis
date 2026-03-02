/**
 * EditorWindow - Container für Editor UI
 * 
 * Presentation Component mit Drag & Drop Support
 */

import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { EditorPanel } from '../../ui/editor/EditorPanel';
import { TilesetUploadDialog, UploadDialogState } from '../../ui/editor/TilesetUploadDialog';
import { EditorService } from '../../services/EditorService';
import { uploadTilesetAsAssetPack } from '../../lib/assetPackUpload';
import { logger } from '../../lib/logger';
import { gameBridge } from '../../game/bridge';

export function EditorWindow({
  onSave,
  onClose,
}: {
  onSave: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = React.useState(EditorService.getState());

  // Window dragging
  const editorWinRef = React.useRef<HTMLDivElement | null>(null);
  const [editorWinPos, setEditorWinPos] = React.useState<{ x: number; y: number } | null>(null);
  const [editorWinDragging, setEditorWinDragging] = React.useState(false);
  const editorWinStartMouseRef = React.useRef<{ x: number; y: number } | null>(null);
  const editorWinStartPosRef = React.useRef<{ x: number; y: number } | null>(null);

  // Upload Dialog
  const [uploadDialog, setUploadDialog] = React.useState<UploadDialogState | null>(null);

  // .mepack Upload & Pack Management
  const [uploading, setUploading] = React.useState(false);
  const [packs, setPacks] = React.useState<Array<{id: number; name: string; version: string; author: string; uuid: string}>>([]);
  const [deleting, setDeleting] = React.useState<number | null>(null);

  // Subscribe zu EditorService
  React.useEffect(() => {
    const unsubscribe = EditorService.subscribe((newState) => {
      setState(newState);
    });
    return unsubscribe;
  }, []);

  // NICHT automatisch aktivieren - wird von außen gesteuert
  // Cleanup beim Unmount
  React.useEffect(() => {
    return () => {
      // Nur deaktivieren wenn der Editor beim Unmount noch aktiv ist
      if (EditorService.getState().active) {
        if (EditorService.hasPendingChanges()) {
          gameBridge.restoreEditorSnapshot();
        }
        EditorService.dispatch({ type: 'DEACTIVATE_EDITOR' });
      }
    };
  }, []);

  // Load installed packs
  React.useEffect(() => {
    const apiBase = (window as any).VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
    fetch(`${apiBase}/asset-packs`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setPacks(data.map((p: any) => ({ id: p.id, name: p.name, version: p.version, author: p.author, uuid: p.uuid })));
      })
      .catch(() => {});
  }, []);

  // Window Dragging
  const beginEditorDrag = (e: React.MouseEvent) => {
    const el = editorWinRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    editorWinStartPosRef.current = { x: rect.left, y: rect.top };
    editorWinStartMouseRef.current = { x: e.clientX, y: e.clientY };
    setEditorWinDragging(true);
    if (!editorWinPos) setEditorWinPos({ x: rect.left, y: rect.top });

    e.preventDefault();
    e.stopPropagation();
  };

  React.useEffect(() => {
    if (!editorWinDragging) return;

    const onMove = (ev: MouseEvent) => {
      if (!editorWinStartMouseRef.current || !editorWinStartPosRef.current) return;
      const dx = ev.clientX - editorWinStartMouseRef.current.x;
      const dy = ev.clientY - editorWinStartMouseRef.current.y;
      setEditorWinPos({ x: editorWinStartPosRef.current.x + dx, y: editorWinStartPosRef.current.y + dy });
    };

    const onUp = () => setEditorWinDragging(false);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [editorWinDragging]);

  // Tileset Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const buf = await file.arrayBuffer();
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(new Blob([buf], { type: file.type || 'image/png' }));
    });

    setUploadDialog({
      open: true,
      dataUrl: base64,
      fileName: file.name,
      tileWidth: file.name.toLowerCase().includes('little') ? 32 : 16,
      tileHeight: file.name.toLowerCase().includes('little') ? 32 : 16,
      margin: 0,
      spacing: 0,
      category: state.category === 'terrain' || state.category === 'structures' || state.category === 'objects'
        ? state.category
        : 'terrain',
    });
  };

  // .mepack Upload
  const handleMepackUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.mepack') && !file.name.endsWith('.zip')) {
      window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Ungültige Datei', description: 'Nur .mepack oder .zip erlaubt', intent: 'error' } }));
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const apiBase = (window as any).VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${apiBase}/asset-packs/upload`, { method: 'POST', body: form, credentials: 'include' });
      if (res.ok) {
        window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Upload erfolgreich', description: 'Pack wurde importiert', intent: 'success' } }));
        setTimeout(() => window.location.reload(), 1000);
      } else {
        const data = await res.json().catch(() => ({ error: 'Unbekannter Fehler' }));
        window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Upload fehlgeschlagen', description: data.error || 'Unbekannter Fehler', intent: 'error' } }));
      }
    } catch {
      window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Upload fehlgeschlagen', description: 'Netzwerkfehler', intent: 'error' } }));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Pack loeschen
  const handleDeletePack = async (id: number, name: string) => {
    if (!window.confirm(`Pack "${name}" wirklich löschen?`)) return;
    setDeleting(id);
    try {
      const apiBase = (window as any).VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
      const res = await fetch(`${apiBase}/asset-packs/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Pack gelöscht', description: `"${name}" wurde entfernt`, intent: 'success' } }));
        setTimeout(() => window.location.reload(), 1000);
      } else {
        const data = await res.json().catch(() => ({ error: 'Unbekannter Fehler' }));
        window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Löschen fehlgeschlagen', description: data.error || 'Unbekannter Fehler', intent: 'error' } }));
      }
    } catch {
      window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Löschen fehlgeschlagen', description: 'Netzwerkfehler', intent: 'error' } }));
    } finally {
      setDeleting(null);
    }
  };

  if (!state.active) return null;

  return (
    <>
      <div
        ref={editorWinRef}
        style={{
          position: 'absolute',
          zIndex: 35,
          width: 560,
          ...(editorWinPos ? { left: editorWinPos.x, top: editorWinPos.y } : { top: 64, right: 12 }),
        }}
      >
        <div
          style={{
            background: 'rgba(17,17,20,0.95)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 12,
            padding: 0,
            color: '#fff',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            onMouseDown={beginEditorDrag}
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.02)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'move',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 16 }}>Map-Editor</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => EditorService.dispatch({ type: 'TOGGLE_GRID' })}
                title="Raster umschalten"
                style={{
                  padding: '6px 10px',
                  background: state.gridVisible ? 'rgba(59,130,246,0.2)' : 'transparent',
                  border: state.gridVisible ? '1px solid #3b82f6' : '1px solid transparent',
                  borderRadius: 6,
                  color: state.gridVisible ? '#3b82f6' : '#9ca3af',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                Grid
              </button>
              <button
                onClick={() => {
                  EditorService.dispatch({ type: 'TOGGLE_VIEW', key: 'collision' });
                  gameBridge.setCollisionVisible(!state.viewToggles.collision);
                }}
                title="Kollisionen anzeigen"
                style={{
                  padding: '6px 10px',
                  background: state.viewToggles.collision ? 'rgba(244,63,94,0.2)' : 'transparent',
                  border: state.viewToggles.collision ? '1px solid #f43f5e' : '1px solid transparent',
                  borderRadius: 6,
                  color: state.viewToggles.collision ? '#f43f5e' : '#9ca3af',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                Collision
              </button>
              <button
                onClick={() => {
                  EditorService.dispatch({ type: 'TOGGLE_VIEW', key: 'zones' });
                  gameBridge.setZonesVisible(!state.viewToggles.zones);
                }}
                title="Zonen anzeigen"
                style={{
                  padding: '6px 10px',
                  background: state.viewToggles.zones ? 'rgba(59,130,246,0.2)' : 'transparent',
                  border: state.viewToggles.zones ? '1px solid #3b82f6' : '1px solid transparent',
                  borderRadius: 6,
                  color: state.viewToggles.zones ? '#3b82f6' : '#9ca3af',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                Zones
              </button>
              <button
                onClick={onClose}
                style={{
                  border: '1px solid var(--border)',
                  background: 'var(--glass)',
                  color: 'var(--fg)',
                  borderRadius: 8,
                  width: 34,
                  height: 28,
                  cursor: 'pointer',
                  lineHeight: '26px',
                  fontSize: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)' }}>
            <button
              onClick={() => EditorService.dispatch({ type: 'SET_CATEGORY', category: 'general' })}
              style={{
                flex: 1,
                padding: '10px 12px',
                border: 'none',
                borderBottom: state.category === 'general' ? '2px solid #3b82f6' : '2px solid transparent',
                background: 'transparent',
                color: state.category === 'general' ? '#3b82f6' : '#9ca3af',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Allgemein
            </button>
            <button
              onClick={() => EditorService.dispatch({ type: 'SET_CATEGORY', category: 'terrain' })}
              style={{
                flex: 1,
                padding: '10px 12px',
                border: 'none',
                borderBottom: state.category === 'terrain' ? '2px solid #3b82f6' : '2px solid transparent',
                background: 'transparent',
                color: state.category === 'terrain' ? '#3b82f6' : '#9ca3af',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Terrain
            </button>
            <button
              onClick={() => EditorService.dispatch({ type: 'SET_CATEGORY', category: 'structures' })}
              style={{
                flex: 1,
                padding: '10px 12px',
                border: 'none',
                borderBottom: state.category === 'structures' ? '2px solid #3b82f6' : '2px solid transparent',
                background: 'transparent',
                color: state.category === 'structures' ? '#3b82f6' : '#9ca3af',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Strukturen
            </button>
            <button
              onClick={() => EditorService.dispatch({ type: 'SET_CATEGORY', category: 'objects' })}
              style={{
                flex: 1,
                padding: '10px 12px',
                border: 'none',
                borderBottom: state.category === 'objects' ? '2px solid #3b82f6' : '2px solid transparent',
                background: 'transparent',
                color: state.category === 'objects' ? '#3b82f6' : '#9ca3af',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Objekte
            </button>
            <button
              onClick={() => EditorService.dispatch({ type: 'SET_CATEGORY', category: 'collisions' })}
              style={{
                flex: 1,
                padding: '10px 12px',
                border: 'none',
                borderBottom: state.category === 'collisions' ? '2px solid #3b82f6' : '2px solid transparent',
                background: 'transparent',
                color: state.category === 'collisions' ? '#3b82f6' : '#9ca3af',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Kollisionen
            </button>
            <button
              onClick={() => EditorService.dispatch({ type: 'SET_CATEGORY', category: 'zones' })}
              style={{
                flex: 1,
                padding: '10px 12px',
                border: 'none',
                borderBottom: state.category === 'zones' ? '2px solid #3b82f6' : '2px solid transparent',
                background: 'transparent',
                color: state.category === 'zones' ? '#3b82f6' : '#9ca3af',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Zonen
            </button>
          </div>

          {/* Content */}
          <EditorPanel
            onSave={onSave}
          />

          {/* Upload Section */}
          {(state.category === 'terrain' || state.category === 'structures' || state.category === 'objects') && (
            <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Upload</div>
                {/* Bild-Upload */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', cursor: 'pointer' }}>
                  <label style={{ cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg)' }}>
                    <span style={{ fontSize: 16 }}>📁</span>
                    <span style={{ fontSize: 13 }}>{t('editor.chooseImage')}</span>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />
                  </label>
                </div>
                {/* .mepack Upload */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
                  <label style={{ cursor: uploading ? 'wait' : 'pointer', flex: 1, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg)' }}>
                    <span style={{ fontSize: 16 }}>📦</span>
                    <span style={{ fontSize: 13 }}>{uploading ? 'Wird hochgeladen...' : '.mepack importieren'}</span>
                    <input type="file" accept=".mepack,.zip" style={{ display: 'none' }} onChange={handleMepackUpload} disabled={uploading} />
                  </label>
                </div>
              </div>
              {/* Installierte Packs */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 8 }}>Installierte Packs</div>
                {packs.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>Keine Packs installiert</div>
                ) : (
                  <div style={{ display: 'grid', gap: 4 }}>
                    {packs.map(pack => (
                      <div key={pack.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass)', fontSize: 12 }}>
                        <div style={{ color: 'var(--fg)' }}>
                          <span style={{ fontWeight: 600 }}>{pack.name}</span>
                          <span style={{ color: '#6b7280', marginLeft: 6 }}>v{pack.version} &bull; {pack.author}</span>
                        </div>
                        <button
                          onClick={() => handleDeletePack(pack.id, pack.name)}
                          disabled={deleting === pack.id}
                          style={{ background: 'none', border: 'none', cursor: deleting === pack.id ? 'wait' : 'pointer', color: '#ef4444', opacity: deleting === pack.id ? 0.5 : 0.7, fontSize: 14, padding: '2px 6px', borderRadius: 4 }}
                          title="Pack löschen"
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div >

      {/* Upload Dialog */}
      {
        uploadDialog && uploadDialog.open && (
          <TilesetUploadDialog
            open={uploadDialog.open}
            dialog={uploadDialog}
            setDialog={setUploadDialog}
            onCancel={() => setUploadDialog(null)}
            onConfirm={async (tileset) => {
              // Upload zum Server für persistente Speicherung
              try {
                const apiBase = (window as any).VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;

                logger.debug('[EditorWindow] Uploading tileset as AssetPack...');

                const result = await uploadTilesetAsAssetPack(tileset, apiBase);

                if (result.success) {
                  logger.debug('[EditorWindow] Tileset uploaded successfully:', result.uuid);
                  try {
                    window.dispatchEvent(new CustomEvent('editor:toast', {
                      detail: {
                        title: 'Upload erfolgreich',
                        description: 'Tileset wurde permanent gespeichert',
                        intent: 'success'
                      }
                    }));
                  } catch { }

                  // Seite neu laden, damit das AssetPack geladen wird
                  setTimeout(() => window.location.reload(), 1000);
                } else {
                  logger.error('[EditorWindow] Upload failed:', result.error);
                  try {
                    window.dispatchEvent(new CustomEvent('editor:toast', {
                      detail: {
                        title: 'Upload fehlgeschlagen',
                        description: result.error || 'Unbekannter Fehler',
                        intent: 'error'
                      }
                    }));
                  } catch { }

                  // Fallback: lokal speichern
                  EditorService.dispatch({ type: 'REGISTER_TILESET', tileset });
                }

                setUploadDialog(null);
              } catch (e: unknown) {
                logger.error('[EditorWindow] Tileset upload failed:', e);
                try {
                  window.dispatchEvent(new CustomEvent('editor:toast', {
                    detail: {
                      title: 'Upload fehlgeschlagen',
                      description: (e instanceof Error ? e.message : null) || 'Unbekannter Fehler',
                      intent: 'error'
                    }
                  }));
                } catch { }

                // Fallback: lokal speichern
                EditorService.dispatch({ type: 'REGISTER_TILESET', tileset });
                setUploadDialog(null);
              }
            }}
          />
        )
      }
    </>
  );
}
