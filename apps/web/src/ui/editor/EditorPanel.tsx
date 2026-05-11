/**
 * EditorPanel: presentation component for the editor UI.
 *
 * Principles:
 * - UI only, no business logic.
 * - Dispatches actions to the EditorService.
 * - Reads props from the EditorService state.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Toast } from '../system';
import { EditorService, PackItem } from '../../services/EditorService';
import { EditorPersistence } from '../../services/EditorPersistence';
import { gameBridge } from '../../game/bridge';
import { useMapStore } from '../../state/mapStore';
import { logger } from '../../lib/logger';
import { AutotilePicker } from './AutotilePicker';
import { TerrainTileGrid } from './TerrainTileGrid';
import { ObjectPropertiesPanel } from './ObjectPropertiesPanel';
import { ZoneEditor } from './ZoneEditor';
import { fetchStateV2 } from '../../lib/mapV2';
import type { V2Tileset } from '../../lib/mapV2';

type ToastState = { title?: string; description?: string; intent?: 'info' | 'success' | 'error' };
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

interface TilesetConfirmDetail {
  dataUrl: string;
  key: string;
  tileWidth: number;
  tileHeight: number;
  margin?: number;
  spacing?: number;
  category?: string;
}

function buildPackItemsFromTileset(
  detail: TilesetConfirmDetail,
  category: 'terrain' | 'structures' | 'objects',
  img: HTMLImageElement,
): PackItem[] {
  const margin = detail.margin || 0;
  const spacing = detail.spacing || 0;
  const cols = Math.max(1, Math.floor((img.width - margin + spacing) / (detail.tileWidth + spacing)));
  const rows = Math.max(1, Math.floor((img.height - margin + spacing) / (detail.tileHeight + spacing)));
  const items: PackItem[] = [];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return items;
  canvas.width = detail.tileWidth;
  canvas.height = detail.tileHeight;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = margin + c * (detail.tileWidth + spacing);
      const sy = margin + r * (detail.tileHeight + spacing);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, sx, sy, detail.tileWidth, detail.tileHeight, 0, 0, detail.tileWidth, detail.tileHeight);
      const url = canvas.toDataURL('image/png');
      items.push({
        packUuid: 'local:tileset',
        itemId: `${detail.key}:${r}:${c}`,
        key: `${detail.key}-${r}-${c}`,
        category,
        dataUrl: url,
        width: detail.tileWidth,
        height: detail.tileHeight,
        collide: false,
      });
    }
  }
  return items;
}

function useEditorEvents(setToast: Setter<ToastState>, setToastOpen: Setter<boolean>, t: (k: string) => string) {
  React.useEffect(() => {
    const onTilesetConfirm = (e: Event) => {
      const detail = (e as CustomEvent<TilesetConfirmDetail>).detail;
      if (!detail || !detail.dataUrl || !detail.tileWidth || !detail.tileHeight) return;
      const category: 'terrain' | 'structures' | 'objects' =
        detail.category === 'structures' || detail.category === 'objects' || detail.category === 'terrain'
          ? detail.category
          : 'terrain';
      const img = new Image();
      img.onload = () => {
        const items = buildPackItemsFromTileset(detail, category, img);
        EditorService.dispatch({ type: 'ADD_PACK_ITEMS', items });
      };
      img.onerror = () => {
        setToast({
          title: t('editor.imageLoadFailedTitle'),
          description: t('editor.imageLoadFailedDesc'),
          intent: 'error',
        });
        setToastOpen(true);
      };
      img.src = detail.dataUrl;
    };
    window.addEventListener('editor:tileset-confirm', onTilesetConfirm);
    return () => window.removeEventListener('editor:tileset-confirm', onTilesetConfirm);
  }, [setToast, setToastOpen, t]);

  React.useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastState>).detail;
      const next: ToastState = {};
      if (detail.title !== undefined) next.title = detail.title;
      if (detail.description !== undefined) next.description = detail.description;
      if (detail.intent !== undefined) next.intent = detail.intent;
      setToast(next);
      setToastOpen(true);
    };
    window.addEventListener('editor:toast', onToast);
    return () => window.removeEventListener('editor:toast', onToast);
  }, [setToast, setToastOpen]);
}

function useV2Tilesets() {
  const [v2Tilesets, setV2Tilesets] = React.useState<V2Tileset[]>([]);
  React.useEffect(() => {
    const mapId = useMapStore.getState().currentMapId;
    if (!mapId) return;
    fetchStateV2(mapId)
      .then((v2) => {
        if (v2?.tilesetRegistry) setV2Tilesets(v2.tilesetRegistry);
      })
      .catch(() => {});
  }, []);
  return v2Tilesets;
}

function GeneralSettings({ state, t }: { state: ReturnType<typeof EditorService.getState>; t: (k: string) => string }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.spawnpoint')}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => EditorService.dispatch({ type: 'SET_TOOL', tool: 'spawn' })}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: state.tool === 'spawn' ? 'rgba(59,130,246,0.18)' : 'var(--glass)',
              color: 'var(--fg)',
              fontSize: 13,
            }}
          >
            {t('editor.setSpawn')}
          </button>
          <button
            onClick={() => EditorService.dispatch({ type: 'CLEAR_SPAWN' })}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--glass)',
              color: 'var(--fg)',
              fontSize: 13,
            }}
          >
            {t('editor.removeSpawn')}
          </button>
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
            {state.spawn ? `(${Math.round(state.spawn.x)}, ${Math.round(state.spawn.y)})` : t('editor.noSpawn')}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.spaceBackground')}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="color"
            value={state.backgroundColor || '#111827'}
            onChange={(e) => EditorService.dispatch({ type: 'SET_BACKGROUND_COLOR', color: e.target.value })}
            style={{
              width: 32,
              height: 32,
              padding: 0,
              border: '1px solid var(--border)',
              borderRadius: 4,
              cursor: 'pointer',
              background: 'none',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--fg)', fontFamily: 'monospace' }}>
            {state.backgroundColor || '#111827'}
          </span>
        </div>
      </div>
    </div>
  );
}

function TerrainSettings({
  state,
  v2Tilesets,
  t,
}: {
  state: ReturnType<typeof EditorService.getState>;
  v2Tilesets: V2Tileset[];
  t: (k: string) => string;
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.terrainBackground')}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="color"
            value={state.terrainColor || '#202020'}
            onChange={(e) => EditorService.dispatch({ type: 'SET_TERRAIN_COLOR', color: e.target.value })}
            style={{
              width: 32,
              height: 32,
              padding: 0,
              border: '1px solid var(--border)',
              borderRadius: 4,
              cursor: 'pointer',
              background: 'none',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--fg)', fontFamily: 'monospace' }}>
            {state.terrainColor || '#202020'}
          </span>
        </div>
      </div>
      <TerrainTileGrid
        v2Tilesets={v2Tilesets}
        selectedTileRefId={state.selectedTileRefId}
        packTerrainItems={state.packItems.filter((it: PackItem) => it.category === 'terrain')}
        pendingAsset={state.pendingAsset}
      />
    </div>
  );
}

function ToolButtons({ state, t }: { state: ReturnType<typeof EditorService.getState>; t: (k: string) => string }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {state.category === 'terrain' && (
        <button
          onClick={() => EditorService.dispatch({ type: 'SET_TOOL', tool: 'terrain' })}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: state.tool === 'terrain' ? 'rgba(59,130,246,0.18)' : 'var(--glass)',
            color: 'var(--fg)',
            fontSize: 13,
          }}
        >
          {t('editor.terrain')}
        </button>
      )}
      {state.category === 'collisions' && (
        <button
          onClick={() => EditorService.dispatch({ type: 'SET_TOOL', tool: 'collision' })}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: state.tool === 'collision' ? 'rgba(244,63,94,0.18)' : 'var(--glass)',
            color: 'var(--fg)',
            fontSize: 13,
          }}
        >
          {t('editor.collisionDraw')}
        </button>
      )}
      {state.category === 'autotiles' && (
        <button
          onClick={() => EditorService.dispatch({ type: 'SET_TOOL', tool: 'wall' })}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: state.tool === 'wall' ? 'rgba(139,90,43,0.18)' : 'var(--glass)',
            color: 'var(--fg)',
            fontSize: 13,
          }}
        >
          {t('editor.wallDraw')}
        </button>
      )}
      {state.category !== 'terrain' &&
        state.category !== 'collisions' &&
        state.category !== 'general' &&
        state.category !== 'autotiles' && (
          <button
            onClick={() => EditorService.dispatch({ type: 'SET_TOOL', tool: 'select' })}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: state.tool === 'select' ? 'rgba(59,130,246,0.18)' : 'var(--glass)',
              color: 'var(--fg)',
              fontSize: 13,
            }}
          >
            {t('editor.select')}
          </button>
        )}
      {state.category !== 'general' && (
        <button
          onClick={() => EditorService.dispatch({ type: 'SET_TOOL', tool: 'erase' })}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: state.tool === 'erase' ? 'rgba(239,68,68,0.18)' : 'var(--glass)',
            color: 'var(--fg)',
            fontSize: 13,
          }}
        >
          {t('editor.delete')}
        </button>
      )}
    </div>
  );
}

function AssetPalette({ state, t }: { state: ReturnType<typeof EditorService.getState>; t: (k: string) => string }) {
  const list = state.packItems.filter((it: PackItem) => it.category === state.category);
  return (
    <>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('editor.packs')}</div>
        {list.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.noPacks')}</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
              gap: 8,
              maxHeight: 260,
              overflow: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--glass)',
              padding: 8,
            }}
          >
            {list.map((item: PackItem) => {
              const selected =
                state.pendingAsset?.itemId === item.itemId && state.pendingAsset?.packUuid === item.packUuid;
              return (
                <button
                  key={`${item.packUuid}:${item.itemId}`}
                  onClick={() => EditorService.dispatch({ type: 'SELECT_ASSET', asset: item })}
                  title={item.key}
                  style={{
                    padding: 4,
                    borderRadius: 8,
                    border: `1px solid ${selected ? 'rgba(59,130,246,0.8)' : 'var(--border)'}`,
                    background: selected ? 'rgba(59,130,246,0.12)' : 'var(--glass)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 64,
                    cursor: 'pointer',
                  }}
                >
                  <img
                    src={item.dataUrl}
                    alt={item.key}
                    style={{ maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' }}
                  />
                </button>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{t('editor.placeHint')}</div>
      </div>
      {state.pendingAsset?.rotationAllowed && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <button
            onClick={() => EditorService.dispatch({ type: 'ROTATE_PENDING_ASSET' })}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--glass)',
              color: 'var(--fg)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {t('editor.rotateR')}
          </button>
          <span style={{ fontSize: 12, color: 'var(--fg-subtle)', fontFamily: 'monospace' }}>
            {state.pendingAsset.rotation ?? 0}°
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Subset of `react-i18next`'s `TFunction` that this file uses. Importing
 * `TFunction` directly is not portable across react-i18next major versions
 * (see notes in SessionManagement.tsx).
 */
type TranslateFn = {
  (key: string): string;
  (key: string, opts: Record<string, unknown>): string;
};

function FooterBar({
  saving,
  lastSavedLabel,
  onSave,
  t,
}: {
  saving: boolean;
  lastSavedLabel: string | null;
  onSave: () => void;
  t: TranslateFn;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
        {lastSavedLabel ? t('editor.lastSaved', { time: lastSavedLabel }) : t('editor.notSaved')}
      </div>
      <button
        onClick={onSave}
        disabled={saving}
        style={{
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'rgba(59,130,246,0.18)',
          color: 'var(--fg)',
          fontSize: 13,
          fontWeight: 600,
          opacity: saving ? 0.7 : 1,
          cursor: saving ? 'default' : 'pointer',
        }}
      >
        {saving
          ? t('editor.saving')
          : `${t('editor.save')}${EditorService.getPendingChangesCount() > 0 ? ` (${EditorService.getPendingChangesCount()})` : ''}`}
      </button>
    </div>
  );
}

function useEditorState() {
  const [state, setState] = React.useState(EditorService.getState());
  React.useEffect(() => EditorService.subscribe((newState) => setState(newState)), []);
  return state;
}

export function EditorPanel(props: { onSave?: () => Promise<boolean> }) {
  const { t } = useTranslation();
  const state = useEditorState();
  const v2Tilesets = useV2Tilesets();
  const [saving, setSaving] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [toastOpen, setToastOpen] = React.useState(false);
  const [toast, setToast] = React.useState<ToastState>({});

  useEditorEvents(setToast, setToastOpen, t);

  const handleSaveClick = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const mapId = useMapStore.getState().currentMapId;
      if (props.onSave) await props.onSave();
      if (mapId && EditorService.hasPendingChanges()) {
        const currentState = EditorService.getState();
        await EditorPersistence.saveAllChanges(mapId, currentState.pendingChanges, currentState);
        EditorService.dispatch({ type: 'CLEAR_PENDING_CHANGES' });
      }
      gameBridge.captureEditorSnapshot();
      setLastSavedAt(Date.now());
      setToast({ title: t('editor.savedTitle'), description: t('editor.changesSaved'), intent: 'success' });
      setToastOpen(true);
    } catch (e: unknown) {
      logger.error('Save failed', e);
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setToast({ title: t('editor.saveFailedTitle'), description: msg, intent: 'error' });
      setToastOpen(true);
    } finally {
      setSaving(false);
    }
  };

  React.useEffect(() => {
    const onSaveShortcut = () => {
      void handleSaveClick();
    };
    window.addEventListener('editor:save', onSaveShortcut);
    return () => window.removeEventListener('editor:save', onSaveShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: handleSaveClick reads via closure but only the saving flag should re-bind the listener
  }, [saving]);

  const lastSavedLabel = React.useMemo(() => {
    if (!lastSavedAt) return null;
    const dt = new Date(lastSavedAt);
    const hh = dt.getHours().toString().padStart(2, '0');
    const mm = dt.getMinutes().toString().padStart(2, '0');
    const ss = dt.getSeconds().toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }, [lastSavedAt]);

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      {state.category === 'general' && <GeneralSettings state={state} t={t} />}
      {state.category === 'terrain' && <TerrainSettings state={state} v2Tilesets={v2Tilesets} t={t} />}
      {state.category === 'autotiles' && (
        <AutotilePicker autotileItems={state.autotileItems} selectedWallTypeId={state.selectedWallTypeId} />
      )}
      <ToolButtons state={state} t={t} />
      {state.category === 'zones' && (
        <ZoneEditor
          zones={state.zones}
          zoneName={state.zoneName}
          editingZoneIndex={state.editingZoneIndex}
          tool={state.tool}
          onSave={props.onSave}
        />
      )}
      {(state.category === 'structures' || state.category === 'objects') && <AssetPalette state={state} t={t} />}
      {(state.category === 'objects' || state.category === 'structures') &&
        state.selectedObjectId &&
        (() => {
          const obj = state.mapObjects.find((o) => String(o.id) === state.selectedObjectId);
          return obj ? <ObjectPropertiesPanel object={obj} /> : null;
        })()}
      <FooterBar
        saving={saving}
        lastSavedLabel={lastSavedLabel}
        onSave={() => {
          void handleSaveClick();
        }}
        t={t}
      />
      <Toast
        open={toastOpen}
        onOpenChange={setToastOpen}
        title={toast.title || ''}
        description={toast.description || ''}
        intent={toast.intent || 'info'}
      />
    </div>
  );
}
