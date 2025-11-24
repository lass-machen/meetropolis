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
import { Checkbox, Toast } from '../system';
import { EditorService, EditorAction, PackItem } from '../../services/EditorService';
import { EditorPersistence } from '../../services/EditorPersistence';
import { logger } from '../../lib/logger';

export function EditorPanel(props: {
  onSave?: () => Promise<boolean>;
  zonesVisible: boolean;
  onZonesVisibleChange: (visible: boolean) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = React.useState(EditorService.getState());
  const [saving, setSaving] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [toastOpen, setToastOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{ title?: string; description?: string; intent?: 'info' | 'success' | 'error' }>({});

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

  const handleSaveClick = async () => {
    if (saving) return;
    setSaving(true);

    try {
      const saveHandler = props.onSave;
      if (saveHandler) {
        const result = await saveHandler();
        if (result) {
          setLastSavedAt(Date.now());
          setToast({ title: t('editor.savedTitle'), description: t('editor.changesSaved'), intent: 'success' });
          setToastOpen(true);
        } else {
          setToast({ title: t('editor.saveFailedTitle'), description: t('editor.saveFailedDesc'), intent: 'error' });
          setToastOpen(true);
        }
      }
    } catch (e: any) {
      logger.error('Save failed', e);
      setToast({ title: t('editor.saveFailedTitle'), description: e.message || 'Unknown error', intent: 'error' });
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
      {/* Background Color */}
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.background')}</div>
        <input
          type="color"
          value={state.backgroundColor}
          onChange={(e) => {
            EditorService.dispatch({ type: 'SET_BACKGROUND_COLOR', color: e.target.value });
          }}
          style={{ width: 48, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'transparent' }}
        />
      </div>

      {/* Spawn Tool */}
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
            {state.spawn ? `Aktueller Spawn: (${Math.round(state.spawn.x)}, ${Math.round(state.spawn.y)})` : 'Kein Spawn gesetzt'}
          </div>
        </div>
      </div>

      {/* Tools */}
      <div style={{ display: 'flex', gap: 6 }}>
        {state.category !== 'terrain' && (
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
      </div>

      {/* Zone-spezifisches UI */}
      {state.category === 'zones' && (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('editor.zones')}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.zoneName')}</label>
            <input
              value={state.zoneName}
              onChange={(e) => EditorService.dispatch({ type: 'SET_ZONE_NAME', name: e.target.value })}
              placeholder={t('editor.exampleRoomName')}
              style={{
                padding: 8,
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--glass)',
                color: 'var(--fg)',
                fontSize: 13,
              }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => EditorService.dispatch({ type: 'SET_TOOL', tool: 'zone' })}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: state.tool === 'zone' ? 'rgba(59,130,246,0.18)' : 'var(--glass)',
                  color: 'var(--fg)',
                  fontSize: 13,
                }}
              >
                {t('editor.drawNew')}
              </button>
            </div>
          </div>

          {/* Existierende Zonen */}
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.existingZones')}</div>
            {state.zones.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.noZones')}</div>
            )}
            {state.zones.map((zone, idx) => (
              <div
                key={idx}
                style={{
                  display: 'grid',
                  gap: 6,
                  padding: 8,
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: state.editingZoneIndex === idx ? 'rgba(59,130,246,0.08)' : 'var(--glass)',
                }}
              >
                <div style={{ display: 'grid', gap: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{t('editor.name')}</label>
                  <input
                    value={zone.name}
                    onChange={(e) => EditorService.dispatch({ type: 'UPDATE_ZONE_NAME', index: idx, name: e.target.value })}
                    style={{
                      padding: 6,
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--glass)',
                      color: 'var(--fg)',
                      fontSize: 12,
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => EditorService.dispatch({ type: 'START_EDIT_ZONE', index: idx })}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--glass)',
                      color: 'var(--fg)',
                      fontSize: 12,
                    }}
                  >
                    Bearbeiten
                  </button>
                  <button
                    onClick={async () => {
                      EditorService.dispatch({ type: 'DELETE_ZONE', index: idx });
                      // Auto-save nach Löschen, damit Server-State synchron bleibt
                      if (props.onSave) {
                        await props.onSave();
                      }
                    }}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'rgba(239,68,68,0.12)',
                      color: 'var(--fg)',
                      fontSize: 12,
                    }}
                  >
                    {t('editor.remove')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Asset-Palette */}
      {(state.category === 'terrain' || state.category === 'structures' || state.category === 'objects') && (
        <>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>
              {state.category === 'terrain' ? t('editor.terrain') : t('editor.packs')}
            </div>
            {(() => {
              const list = state.packItems.filter(it => it.category === state.category);
              if (list.length === 0) {
                return (
                  <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
                    {state.category === 'terrain' ? t('editor.noTerrain') : t('editor.noPacks')}
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
              {state.category === 'terrain' ? t('editor.hintTerrain') : t('editor.placeHint')}
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
          {lastSavedLabel ? t('editor.lastSaved', { time: lastSavedLabel }) : t('editor.notSaved')}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-subtle)' }}>
          <Checkbox checked={props.zonesVisible} onChange={e => props.onZonesVisibleChange((e.target as HTMLInputElement).checked)} />{' '}
          {t('editor.showZones')}
        </label>
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
          {saving ? t('editor.saving') : t('editor.save')}
        </button>
      </div>

      <Toast open={toastOpen} onOpenChange={setToastOpen} title={toast.title || ''} description={toast.description || ''} intent={toast.intent || 'info'} />
    </div>
  );
}
