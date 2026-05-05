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
import { getApiBaseFromWindow } from '../../lib/apiBase';

type Pack = { id: number; name: string; version: string; author: string; uuid: string };

function dispatchToast(title: string, description: string, intent: 'success' | 'error' | 'info') {
  try { window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title, description, intent } })); } catch {}
}

function useEditorWinDrag() {
  const editorWinRef = React.useRef<HTMLDivElement | null>(null);
  const [editorWinPos, setEditorWinPos] = React.useState<{ x: number; y: number } | null>(null);
  const [editorWinDragging, setEditorWinDragging] = React.useState(false);
  const editorWinStartMouseRef = React.useRef<{ x: number; y: number } | null>(null);
  const editorWinStartPosRef = React.useRef<{ x: number; y: number } | null>(null);

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
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [editorWinDragging]);

  return { editorWinRef, editorWinPos, beginEditorDrag };
}

function useEditorWinState() {
  const [state, setState] = React.useState(EditorService.getState());
  React.useEffect(() => EditorService.subscribe((newState) => setState(newState)), []);
  React.useEffect(() => {
    return () => {
      if (EditorService.getState().active) {
        if (EditorService.hasPendingChanges()) gameBridge.restoreEditorSnapshot();
        EditorService.dispatch({ type: 'DEACTIVATE_EDITOR' });
      }
    };
  }, []);
  return state;
}

function useInstalledPacks() {
  const [packs, setPacks] = React.useState<Pack[]>([]);
  React.useEffect(() => {
    const apiBase = getApiBaseFromWindow();
    fetch(`${apiBase}/asset-packs`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setPacks(data.map((p: any) => ({ id: p.id, name: p.name, version: p.version, author: p.author, uuid: p.uuid })));
      })
      .catch(() => {});
  }, []);
  return packs;
}

const TAB_DEFS: Array<{ key: any; label: string }> = [
  { key: 'general', label: 'Allgemein' },
  { key: 'terrain', label: 'Terrain' },
  { key: 'structures', label: 'Strukturen' },
  { key: 'objects', label: 'Objekte' },
  { key: 'autotiles', label: 'Waende' },
  { key: 'collisions', label: 'Kollisionen' },
  { key: 'zones', label: 'Zonen' },
];

function EditorTabs({ activeCategory }: { activeCategory: string }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)' }}>
      {TAB_DEFS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => EditorService.dispatch({ type: 'SET_CATEGORY', category: key })}
          style={{ flex: 1, padding: '10px 12px', border: 'none', borderBottom: activeCategory === key ? '2px solid #3b82f6' : '2px solid transparent', background: 'transparent', color: activeCategory === key ? '#3b82f6' : '#9ca3af', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ToggleButton({ active, label, onColor, onClick, title }: { active: boolean; label: string; onColor: string; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ padding: '6px 10px', background: active ? `rgba(${onColor},0.2)` : 'transparent', border: active ? `1px solid rgb(${onColor})` : '1px solid transparent', borderRadius: 6, color: active ? `rgb(${onColor})` : '#9ca3af', cursor: 'pointer', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}
    >
      {label}
    </button>
  );
}

function EditorHeader({ state, onClose, beginEditorDrag }: { state: any; onClose: () => void; beginEditorDrag: (e: React.MouseEvent) => void }) {
  return (
    <div onMouseDown={beginEditorDrag} style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'move' }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>Map-Editor</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <ToggleButton active={state.gridVisible} label="Grid" onColor="59,130,246" onClick={() => EditorService.dispatch({ type: 'TOGGLE_GRID' })} title="Raster umschalten" />
        <ToggleButton active={state.viewToggles.collision} label="Collision" onColor="244,63,94" onClick={() => { EditorService.dispatch({ type: 'TOGGLE_VIEW', key: 'collision' }); gameBridge.setCollisionVisible(!state.viewToggles.collision); }} title="Kollisionen anzeigen" />
        <ToggleButton active={state.viewToggles.zones} label="Zones" onColor="59,130,246" onClick={() => { EditorService.dispatch({ type: 'TOGGLE_VIEW', key: 'zones' }); gameBridge.setZonesVisible(!state.viewToggles.zones); }} title="Zonen anzeigen" />
        <button onClick={onClose} style={{ border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', borderRadius: 8, width: 34, height: 28, cursor: 'pointer', lineHeight: '26px', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
      </div>
    </div>
  );
}

function PacksList({ packs, deleting, onDelete, t }: { packs: Pack[]; deleting: number | null; onDelete: (id: number, name: string) => void; t: (k: string, opts?: any) => string }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 8 }}>{t('editor.installedPacks')}</div>
      {packs.length === 0 ? (
        <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>{t('editor.noPacksInstalled')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 4 }}>
          {packs.map(pack => (
            <div key={pack.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--glass)', fontSize: 12 }}>
              <div style={{ color: 'var(--fg)' }}>
                <span style={{ fontWeight: 600 }}>{pack.name}</span>
                <span style={{ color: '#6b7280', marginLeft: 6 }}>v{pack.version} &bull; {pack.author}</span>
              </div>
              <button onClick={() => onDelete(pack.id, pack.name)} disabled={deleting === pack.id} style={{ background: 'none', border: 'none', cursor: deleting === pack.id ? 'wait' : 'pointer', color: '#ef4444', opacity: deleting === pack.id ? 0.5 : 0.7, fontSize: 14, padding: '2px 6px', borderRadius: 4 }} title={t('editor.deletePack')}>🗑️</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadSection({ uploading, packs, deleting, onFileUpload, onMepackUpload, onDelete, t }: { uploading: boolean; packs: Pack[]; deleting: number | null; onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void; onMepackUpload: (e: React.ChangeEvent<HTMLInputElement>) => void; onDelete: (id: number, name: string) => void; t: (k: string, opts?: any) => string }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Upload</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', cursor: 'pointer' }}>
          <label style={{ cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg)' }}>
            <span style={{ fontSize: 16 }}>📁</span>
            <span style={{ fontSize: 13 }}>{t('editor.chooseImage')}</span>
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileUpload} />
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
          <label style={{ cursor: uploading ? 'wait' : 'pointer', flex: 1, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg)' }}>
            <span style={{ fontSize: 16 }}>📦</span>
            <span style={{ fontSize: 13 }}>{uploading ? t('editor.uploading') : t('editor.importMepack')}</span>
            <input type="file" accept=".mepack,.zip" style={{ display: 'none' }} onChange={onMepackUpload} disabled={uploading} />
          </label>
        </div>
      </div>
      <PacksList packs={packs} deleting={deleting} onDelete={onDelete} t={t} />
    </div>
  );
}

async function fileToDataUrl(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(new Blob([buf], { type: file.type || 'image/png' }));
  });
}

function buildUploadDialogState(file: File, dataUrl: string, currentCategory: string): UploadDialogState {
  return {
    open: true,
    dataUrl,
    fileName: file.name,
    tileWidth: file.name.toLowerCase().includes('little') ? 32 : 16,
    tileHeight: file.name.toLowerCase().includes('little') ? 32 : 16,
    margin: 0,
    spacing: 0,
    category: currentCategory === 'terrain' || currentCategory === 'structures' || currentCategory === 'objects' ? (currentCategory as any) : 'terrain',
  };
}

async function uploadMepackFile(file: File, t: (k: string) => string): Promise<boolean> {
  try {
    const apiBase = getApiBaseFromWindow();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${apiBase}/asset-packs/upload`, { method: 'POST', body: form, credentials: 'include' });
    if (res.ok) {
      dispatchToast(t('editor.uploadSuccess'), t('editor.uploadSuccessDesc'), 'success');
      setTimeout(() => window.location.reload(), 1000);
      return true;
    }
    const data = await res.json().catch(() => ({ error: t('common.error') }));
    dispatchToast(t('editor.uploadFailed'), data.error || t('common.error'), 'error');
  } catch {
    dispatchToast(t('editor.uploadFailed'), t('common.networkError'), 'error');
  }
  return false;
}

async function deletePackById(id: number, name: string, t: (k: string, opts?: any) => string): Promise<boolean> {
  try {
    const apiBase = getApiBaseFromWindow();
    const res = await fetch(`${apiBase}/asset-packs/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      dispatchToast(t('editor.packDeleted'), t('editor.packDeletedDesc', { name }), 'success');
      setTimeout(() => window.location.reload(), 1000);
      return true;
    }
    const data = await res.json().catch(() => ({ error: t('common.error') }));
    dispatchToast(t('editor.deleteFailed'), data.error || t('common.error'), 'error');
  } catch {
    dispatchToast(t('editor.deleteFailed'), t('common.networkError'), 'error');
  }
  return false;
}

async function handleTilesetConfirm(tileset: any, t: (k: string) => string, setUploadDialog: (v: any) => void) {
  try {
    const apiBase = getApiBaseFromWindow();
    logger.debug('[EditorWindow] Uploading tileset as AssetPack...');
    const result = await uploadTilesetAsAssetPack(tileset, apiBase);
    if (result.success) {
      logger.debug('[EditorWindow] Tileset uploaded successfully:', result.uuid);
      dispatchToast(t('editor.uploadSuccess'), t('editor.tilesetSaved'), 'success');
      setTimeout(() => window.location.reload(), 1000);
    } else {
      logger.error('[EditorWindow] Upload failed:', result.error);
      dispatchToast(t('editor.uploadFailed'), result.error || t('common.error'), 'error');
      EditorService.dispatch({ type: 'REGISTER_TILESET', tileset });
    }
  } catch (e: unknown) {
    logger.error('[EditorWindow] Tileset upload failed:', e);
    dispatchToast(t('editor.uploadFailed'), (e instanceof Error ? e.message : null) || t('common.error'), 'error');
    EditorService.dispatch({ type: 'REGISTER_TILESET', tileset });
  }
  setUploadDialog(null);
}

export function EditorWindow({ onSave, onClose }: { onSave: () => Promise<boolean>; onClose: () => void }) {
  const { t } = useTranslation();
  const state = useEditorWinState();
  const { editorWinRef, editorWinPos, beginEditorDrag } = useEditorWinDrag();
  const packs = useInstalledPacks();
  const [uploadDialog, setUploadDialog] = React.useState<UploadDialogState | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [deleting, setDeleting] = React.useState<number | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setUploadDialog(buildUploadDialogState(file, dataUrl, state.category));
  };

  const handleMepackUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.mepack') && !file.name.endsWith('.zip')) {
      dispatchToast(t('editor.invalidFile'), t('editor.invalidFileDesc'), 'error');
      e.target.value = '';
      return;
    }
    setUploading(true);
    await uploadMepackFile(file, t);
    setUploading(false);
    e.target.value = '';
  };

  const handleDeletePack = async (id: number, name: string) => {
    if (!window.confirm(t('editor.confirmDeletePack', { name }))) return;
    setDeleting(id);
    await deletePackById(id, name, t);
    setDeleting(null);
  };

  if (!state.active) return null;

  return (
    <>
      <div ref={editorWinRef} style={{ position: 'absolute', zIndex: 35, width: 560, ...(editorWinPos ? { left: editorWinPos.x, top: editorWinPos.y } : { top: 64, right: 12 }) }}>
        <div style={{ background: 'rgba(17,17,20,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 0, color: '#fff', overflow: 'hidden' }}>
          <EditorHeader state={state} onClose={onClose} beginEditorDrag={beginEditorDrag} />
          <EditorTabs activeCategory={state.category} />
          <EditorPanel onSave={onSave} />
          {(state.category === 'terrain' || state.category === 'structures' || state.category === 'objects') && (
            <UploadSection uploading={uploading} packs={packs} deleting={deleting} onFileUpload={handleFileUpload} onMepackUpload={handleMepackUpload} onDelete={handleDeletePack} t={t} />
          )}
        </div>
      </div>
      {uploadDialog && uploadDialog.open && (
        <TilesetUploadDialog
          open={uploadDialog.open}
          dialog={uploadDialog}
          setDialog={setUploadDialog}
          onCancel={() => setUploadDialog(null)}
          onConfirm={(tileset) => handleTilesetConfirm(tileset, t, setUploadDialog)}
        />
      )}
    </>
  );
}
