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
        EditorService.dispatch({ type: 'DEACTIVATE_EDITOR' });
      }
    };
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
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('editor.uploadTileset')}</div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--glass)',
                    cursor: 'pointer',
                  }}
                >
                  <label style={{ cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg)' }}>
                    <span style={{ fontSize: 16 }}>📁</span>
                    <span style={{ fontSize: 13 }}>{t('editor.chooseImage')}</span>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />
                  </label>
                </div>
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
                      description: e.message || 'Unbekannter Fehler',
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
