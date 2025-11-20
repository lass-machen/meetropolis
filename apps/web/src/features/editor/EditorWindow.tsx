import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { gameBridge } from '../../game/bridge';
import { EditorPanel } from '../../ui/editor/EditorPanel';
import { TilesetUploadDialog, UploadDialogState } from '../../ui/editor/TilesetUploadDialog';
import { Modal, Button } from '../../ui/system';

export function EditorWindow({
  editor,
  setEditor,
  onSave,
}: {
  editor: any;
  setEditor: React.Dispatch<React.SetStateAction<any>>;
  onSave: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const editorWinRef = React.useRef<HTMLDivElement | null>(null);
  const [editorWinPos, setEditorWinPos] = React.useState<{ x: number; y: number } | null>(null);
  const [editorWinDragging, setEditorWinDragging] = React.useState(false);
  const editorWinStartMouseRef = React.useRef<{ x: number; y: number } | null>(null);
  const editorWinStartPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const [editorDirty, setEditorDirty] = React.useState(false);
  const [confirmExitOpen, setConfirmExitOpen] = React.useState(false);
  const editorSavedSnapshotRef = React.useRef<string | null>(null);

  const getEditorSnapshot = React.useCallback(() => {
    try {
      return JSON.stringify({ zones: editor.zones, spawn: editor.spawn, backgroundColor: editor.backgroundColor });
    } catch (e) {
      console.error('Failed to snapshot editor state', e);
      return null;
    }
  }, [editor.zones, editor.spawn, editor.backgroundColor]);

  const beginEditorDrag = (e: React.MouseEvent) => {
    try {
      const el = editorWinRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      editorWinStartPosRef.current = { x: rect.left, y: rect.top };
      editorWinStartMouseRef.current = { x: e.clientX, y: e.clientY };
      setEditorWinDragging(true);
      if (!editorWinPos) setEditorWinPos({ x: rect.left, y: rect.top });
      e.preventDefault();
      e.stopPropagation();
    } catch (err) { console.warn('Drag start failed', err); }
  };

  React.useEffect(() => {
    if (!editorWinDragging) return;
    const onMove = (ev: MouseEvent) => {
      try {
        if (!editorWinStartMouseRef.current || !editorWinStartPosRef.current) return;
        const dx = ev.clientX - editorWinStartMouseRef.current.x;
        const dy = ev.clientY - editorWinStartMouseRef.current.y;
        setEditorWinPos({ x: editorWinStartPosRef.current.x + dx, y: editorWinStartPosRef.current.y + dy });
      } catch (err) { console.warn('Drag move failed', err); }
    };
    const onUp = () => setEditorWinDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp as any);
    };
  }, [editorWinDragging]);

  React.useEffect(() => {
    // Initialize snapshot when editor is opened
    if (editor.active && editorSavedSnapshotRef.current === null) {
      editorSavedSnapshotRef.current = getEditorSnapshot();
      setEditorDirty(false);
    }
    if (!editor.active) {
      editorSavedSnapshotRef.current = null;
      setEditorDirty(false);
    }
  }, [editor.active, getEditorSnapshot]);

  React.useEffect(() => {
    if (!editor.active) return;
    const now = getEditorSnapshot();
    const base = editorSavedSnapshotRef.current;
    setEditorDirty(!!(base && now && base !== now));
  }, [getEditorSnapshot, editor.active]);

  if (!editor.active) return null;

  return (
    <>
      <div ref={editorWinRef} style={{ position: 'absolute', zIndex: 35, width: 360, ...(editorWinPos ? { left: editorWinPos.x, top: editorWinPos.y } : { top: 64, right: 12 }) }}>
        <div style={{ background: 'rgba(17,17,20,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 0, color: '#fff', overflow: 'hidden' }}>
          <div onMouseDown={beginEditorDrag} style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'move' }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Map-Editor</div>
            <button
              onClick={() => {
                if (editorDirty) { setConfirmExitOpen(true); return; }
                try { (window as any).currentPhaserScene?.setAssetPreview?.(null); } catch (e) { console.error('Failed to clear asset preview', e); }
                try { gameBridge.setEditorMode(false); } catch (e) { console.error('Failed to disable editor mode', e); }
                setEditor((s: any) => ({ ...s, pendingTerrain: null as any, pendingAsset: null as any, tool: 'select', active: false } as any));
              }}
              title="Editor verlassen"
              style={{ border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', borderRadius: 8, width: 34, height: 28, cursor: 'pointer', lineHeight: '26px', fontSize: 18 }}
            >
              ×
            </button>
          </div>

          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)' }}>
            <button onClick={() => setEditor((s: any) => ({ ...s, category: 'terrain', tool: 'floor' }))} style={{ flex: 1, padding: '10px 12px', border: 'none', borderBottom: editor.category==='terrain'?'2px solid #3b82f6':'2px solid transparent', background: 'transparent', color: editor.category==='terrain'?'#3b82f6':'#9ca3af', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Terrain</button>
            <button onClick={() => setEditor((s: any) => ({ ...s, category: 'structures', tool: 'walls' }))} style={{ flex: 1, padding: '10px 12px', border: 'none', borderBottom: editor.category==='structures'?'2px solid #3b82f6':'2px solid transparent', background: 'transparent', color: editor.category==='structures'?'#3b82f6':'#9ca3af', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Strukturen</button>
            <button onClick={() => setEditor((s: any) => ({ ...s, category: 'objects', tool: 'asset' }))} style={{ flex: 1, padding: '10px 12px', border: 'none', borderBottom: editor.category==='objects'?'2px solid #3b82f6':'2px solid transparent', background: 'transparent', color: editor.category==='objects'?'#3b82f6':'#9ca3af', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Objekte</button>
            <button onClick={() => setEditor((s: any) => ({ ...s, category: 'zones', tool: 'zone' }))} style={{ flex: 1, padding: '10px 12px', border: 'none', borderBottom: editor.category==='zones'?'2px solid #3b82f6':'2px solid transparent', background: 'transparent', color: editor.category==='zones'?'#3b82f6':'#9ca3af', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Zonen</button>
          </div>

          <EditorPanel
            editor={editor}
            setEditor={setEditor}
            onSave={onSave}
            onDirtyChange={(dirty: boolean)=> setEditorDirty(!!dirty)}
            onOpenUpload={async (e: any) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const buf = await file.arrayBuffer();
              const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(new Blob([buf], { type: file.type || 'image/png' }));
              });
              setEditor((s: any) => ({ 
                ...s, 
                uploadDialog: {
                  open: true,
                  dataUrl: base64,
                  fileName: file.name,
                  tileWidth: file.name.toLowerCase().includes('little') ? 32 : 16,
                  tileHeight: file.name.toLowerCase().includes('little') ? 32 : 16,
                  margin: 0,
                  spacing: 0,
                  category: s.category
                }
              }));
            }}
            onSaveEditor={async () => { return await onSave(); }}
          />
        </div>
      </div>

      <Modal open={confirmExitOpen} onOpenChange={setConfirmExitOpen} title={t('editor.confirmExitTitle')} description={t('editor.confirmExitDesc')} maxWidth={420}>
        <div style={{ display:'flex', justifyContent:'flex-end', gap: 8 }}>
          <Button onClick={() => setConfirmExitOpen(false)}>{t('editor.exitCancel')}</Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmExitOpen(false);
              try { (window as any).currentPhaserScene?.setAssetPreview?.(null); } catch (e) { console.error('Failed to clear asset preview', e); }
              try { gameBridge.setEditorMode(false); } catch (e) { console.error('Failed to disable editor mode', e); }
              setEditor((s: any) => ({ ...s, pendingTerrain: null as any, pendingAsset: null as any, tool: 'select', active: false } as any));
            }}
          >
            {t('editor.exitConfirm')}
          </Button>
        </div>
      </Modal>
      {editor.uploadDialog && editor.uploadDialog.open && (
        <TilesetUploadDialog
          open={editor.uploadDialog.open}
          dialog={editor.uploadDialog as UploadDialogState}
          setDialog={(next) => {
            setEditor((s: any) => ({ ...s, uploadDialog: next }));
          }}
          onCancel={() => {
            setEditor((s: any) => ({ ...s, uploadDialog: null }));
          }}
          onConfirm={(tileset) => {
            try {
              gameBridge.registerTileset({
                key: tileset.key,
                dataUrl: tileset.dataUrl,
                tileWidth: tileset.tileWidth,
                tileHeight: tileset.tileHeight,
                margin: tileset.margin,
                spacing: tileset.spacing,
              });
            } catch (e: any) {
              console.error('Failed to register tileset via gameBridge', e);
              try {
                const ev = new CustomEvent('editor:toast', {
                  detail: {
                    title: 'Tileset-Upload fehlgeschlagen',
                    description: (e?.message || 'Tileset konnte nicht registriert werden.').toString(),
                    intent: 'error',
                  },
                });
                window.dispatchEvent(ev);
              } catch {}
            }
            setEditor((s: any) => {
              const prev = Array.isArray(s.tilesets) ? s.tilesets : [];
              const filtered = prev.filter((ts: any) => ts && ts.key !== tileset.key);
              return {
                ...s,
                tilesets: [...filtered, tileset],
                uploadDialog: null,
              };
            });
          }}
        />
      )}
    </>
  );
}


