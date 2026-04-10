/**
 * EditorPanel - Presentation Component für Editor UI
 * 
 * Prinzipien:
 * - Nur UI, keine Business-Logik
 * - Dispatcht Actions an EditorService
 * - Nutzt Props vom EditorService State
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

export function EditorPanel(props: {
  onSave?: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [state, setState] = React.useState(EditorService.getState());
  const [saving, setSaving] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [toastOpen, setToastOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{ title?: string; description?: string; intent?: 'info' | 'success' | 'error' }>({});

  // V2 Tilesets state
  const [v2Tilesets, setV2Tilesets] = React.useState<V2Tileset[]>([]);

  // Subscribe zu EditorService
  React.useEffect(() => {
    const unsubscribe = EditorService.subscribe((newState) => {
      setState(newState);
    });
    return unsubscribe;
  }, []);

  // Tileset-Upload Handler
  React.useEffect(() => {
    const onTilesetConfirm = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || !detail.dataUrl || !detail.tileWidth || !detail.tileHeight) {
        return;
      }

      const category = (detail.category === 'structures' || detail.category === 'objects' || detail.category === 'terrain')
        ? detail.category
        : 'terrain';

      const img = new Image();
      img.onload = () => {
        const margin = detail.margin || 0;
        const spacing = detail.spacing || 0;
        const cols = Math.max(1, Math.floor((img.width - margin + spacing) / (detail.tileWidth + spacing)));
        const rows = Math.max(1, Math.floor((img.height - margin + spacing) / (detail.tileHeight + spacing)));
        const items: PackItem[] = [];

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = detail.tileWidth;
        canvas.height = detail.tileHeight;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const sx = margin + c * (detail.tileWidth + spacing);
            const sy = margin + r * (detail.tileHeight + spacing);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, sx, sy, detail.tileWidth, detail.tileHeight, 0, 0, detail.tileWidth, detail.tileHeight);

            const url = canvas.toDataURL('image/png');
            const itemId = `${detail.key}:${r}:${c}`;
            items.push({
              packUuid: 'local:tileset',
              itemId,
              key: `${detail.key}-${r}-${c}`,
              category,
              dataUrl: url,
              width: detail.tileWidth,
              height: detail.tileHeight,
              collide: false,
            });
          }
        }

        EditorService.dispatch({ type: 'ADD_PACK_ITEMS', items });
      };

      img.onerror = () => {
        setToast({ title: 'Fehler', description: 'Bild konnte nicht geladen werden', intent: 'error' });
        setToastOpen(true);
      };

      img.src = detail.dataUrl;
    };

    window.addEventListener('editor:tileset-confirm', onTilesetConfirm);
    return () => window.removeEventListener('editor:tileset-confirm', onTilesetConfirm);
  }, []);

  // Toast Events
  React.useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setToast({ title: detail.title, description: detail.description, intent: detail.intent });
      setToastOpen(true);
    };

    window.addEventListener('editor:toast', onToast);
    return () => window.removeEventListener('editor:toast', onToast);
  }, []);

  // V2 Tilesets laden
  React.useEffect(() => {
    const mapId = useMapStore.getState().currentMapId;
    if (!mapId) return;
    fetchStateV2(mapId).then(v2 => {
      if (v2?.tilesetRegistry) setV2Tilesets(v2.tilesetRegistry);
    }).catch(() => {});
  }, []);

  // Keyboard shortcut listener for Ctrl/Cmd+S
  React.useEffect(() => {
    const onSaveShortcut = () => { handleSaveClick(); };
    window.addEventListener('editor:save', onSaveShortcut);
    return () => window.removeEventListener('editor:save', onSaveShortcut);
  }, [saving]);

  const handleSaveClick = async () => {
    if (saving) return;
    setSaving(true);

    try {
      const mapId = useMapStore.getState().currentMapId;

      // Legacy save (zones, assets, spawn via editor-state)
      if (props.onSave) {
        await props.onSave();
      }

      // V2 save (pending changes via REST API)
      if (mapId && EditorService.hasPendingChanges()) {
        const currentState = EditorService.getState();
        await EditorPersistence.saveAllChanges(mapId, currentState.pendingChanges, currentState);
        EditorService.dispatch({ type: 'CLEAR_PENDING_CHANGES' });
      }

      // Capture new snapshot of the now-saved state
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



      {/* General Settings */}
      {state.category === 'general' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Spawn Point */}
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Spawnpunkt</div>
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
                Spawn setzen
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
                Entfernen
              </button>
              <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
                {state.spawn ? `(${Math.round(state.spawn.x)}, ${Math.round(state.spawn.y)})` : 'Kein Spawn'}
              </div>
            </div>
          </div>

          {/* Space Background */}
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Space Hintergrund</div>
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
      )}

      {/* Terrain Settings */}
      {state.category === 'terrain' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Terrain Background */}
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Terrain Hintergrund</div>
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

          {/* V2 Terrain Tile Grid + Pack Terrain Items */}
          <TerrainTileGrid
            v2Tilesets={v2Tilesets}
            selectedTileRefId={state.selectedTileRefId}
            packTerrainItems={state.packItems.filter(it => it.category === 'terrain')}
            pendingAsset={state.pendingAsset}
          />
        </div>
      )}

      {/* Autotile Picker */}
      {state.category === 'autotiles' && (
        <AutotilePicker
          autotileItems={state.autotileItems}
          selectedWallTypeId={state.selectedWallTypeId}
        />
      )}

      {/* Tools */}
      <div style={{ display: 'flex', gap: 6 }}>
        {state.category === 'terrain' && (
          <>
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
              Terrain
            </button>
          </>
        )}
        {state.category === 'collisions' && (
          <>
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
              Kollision zeichnen
            </button>
          </>
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
            Wand zeichnen
          </button>
        )}
        {state.category !== 'terrain' && state.category !== 'collisions' && state.category !== 'general' && state.category !== 'autotiles' && (
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

      {/* Zone-spezifisches UI */}
      {state.category === 'zones' && (
        <ZoneEditor
          zones={state.zones}
          zoneName={state.zoneName}
          editingZoneIndex={state.editingZoneIndex}
          tool={state.tool}
          onSave={props.onSave}
        />
      )}

      {/* Asset-Palette */}
      {(state.category === 'structures' || state.category === 'objects') && (
        <>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>
              {t('editor.packs')}
            </div>
            {(() => {
              const list = state.packItems.filter(it => it.category === state.category);
              if (list.length === 0) {
                return (
                  <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
                    {t('editor.noPacks')}
                  </div>
                );
              }
              return (
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
                  {list.map(item => {
                    const selected = state.pendingAsset?.itemId === item.itemId && state.pendingAsset?.packUuid === item.packUuid;
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
                        <img src={item.dataUrl} alt={item.key} style={{ maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' }} />
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
              {t('editor.placeHint')}
            </div>
          </div>

          {/* Rotation Control */}
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
                Rotieren (R)
              </button>
              <span style={{ fontSize: 12, color: 'var(--fg-subtle)', fontFamily: 'monospace' }}>
                {state.pendingAsset.rotation ?? 0}°
              </span>
            </div>
          )}
        </>
      )}

      {/* Object Properties Panel */}
      {(state.category === 'objects' || state.category === 'structures') && state.selectedObjectId && (() => {
        const obj = state.mapObjects.find(o => String(o.id) === state.selectedObjectId);
        return obj ? <ObjectPropertiesPanel object={obj} /> : null;
      })()}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
          {lastSavedLabel ? t('editor.lastSaved', { time: lastSavedLabel }) : t('editor.notSaved')}
        </div>

        <button
          onClick={handleSaveClick}
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
          {saving ? t('editor.saving') : `${t('editor.save')}${EditorService.getPendingChangesCount() > 0 ? ` (${EditorService.getPendingChangesCount()})` : ''}`}
        </button>
      </div>

      <Toast open={toastOpen} onOpenChange={setToastOpen} title={toast.title || ''} description={toast.description || ''} intent={toast.intent || 'info'} />
    </div>
  );
}
