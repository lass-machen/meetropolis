/**
 * ZoneEditor - Zone-Bearbeitungs-UI Komponente
 *
 * Extrahiert aus EditorPanel.tsx zur Einhaltung des 600 LoC Budgets.
 */

import { useTranslation } from 'react-i18next';
import { EditorService } from '../../services/EditorService';
import { useMapStore } from '../../state/mapStore';
import type { Zone, EditorTool } from '../../services/EditorTypes';

export function ZoneEditor(props: {
  zones: Zone[];
  zoneName: string;
  editingZoneIndex: number | null;
  tool: EditorTool;
  onSave?: (() => Promise<boolean>) | undefined;
}) {
  const { t } = useTranslation();
  const { zones, zoneName, editingZoneIndex, tool, onSave } = props;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('editor.zones')}</div>
        <button
          onClick={async () => {
            if (onSave) {
              const saved = await onSave();
              if (saved) {
                try { window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Gespeichert', description: 'Zonen wurden gespeichert', intent: 'success' } })); } catch { }
              }
            }
          }}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'rgba(34,197,94,0.12)',
            color: 'var(--fg)',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          💾 Speichern
        </button>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.zoneName')}</label>
        <input
          value={zoneName}
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
              background: tool === 'zone' ? 'rgba(59,130,246,0.18)' : 'var(--glass)',
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
        {zones.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.noZones')}</div>
        )}
        {zones.map((zone, idx) => {
          const availableMaps = useMapStore.getState().availableMaps;
          return (
            <div
              key={idx}
              style={{
                display: 'grid',
                gap: 6,
                padding: 8,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: editingZoneIndex === idx ? 'rgba(59,130,246,0.08)' : 'var(--glass)',
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
              {/* Zone Type */}
              <div style={{ display: 'grid', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>Typ</label>
                <select
                  value={zone.type || 'default'}
                  onChange={(e) => EditorService.dispatch({ type: 'UPDATE_ZONE_TYPE', index: idx, zoneType: e.target.value as 'default' | 'portal' })}
                  style={{
                    padding: 6,
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--glass)',
                    color: 'var(--fg)',
                    fontSize: 12,
                  }}
                >
                  <option value="default">Normal</option>
                  <option value="portal">Portal</option>
                </select>
              </div>
              {/* Portal fields */}
              {zone.type === 'portal' && (
                <div style={{ display: 'grid', gap: 4, padding: '6px 0 0' }}>
                  <label style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>Ziel-Map</label>
                  <select
                    value={zone.portalTarget || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const action: Parameters<typeof EditorService.dispatch>[0] = val
                        ? { type: 'UPDATE_ZONE_PORTAL', index: idx, portalTarget: val }
                        : { type: 'UPDATE_ZONE_PORTAL', index: idx };
                      EditorService.dispatch(action);
                    }}
                    style={{
                      padding: 6,
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--glass)',
                      color: 'var(--fg)',
                      fontSize: 12,
                    }}
                  >
                    <option value="">-- Ziel wählen --</option>
                    {availableMaps.map(m => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                  </select>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1, display: 'grid', gap: 2 }}>
                      <label style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>Spawn X (Tile)</label>
                      <input
                        type="number"
                        value={zone.portalSpawnX ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const action: Parameters<typeof EditorService.dispatch>[0] = val
                            ? { type: 'UPDATE_ZONE_PORTAL', index: idx, portalSpawnX: Number(val) }
                            : { type: 'UPDATE_ZONE_PORTAL', index: idx };
                          EditorService.dispatch(action);
                        }}
                        placeholder="auto"
                        style={{
                          padding: 4,
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--glass)',
                          color: 'var(--fg)',
                          fontSize: 11,
                          width: '100%',
                        }}
                      />
                    </div>
                    <div style={{ flex: 1, display: 'grid', gap: 2 }}>
                      <label style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>Spawn Y (Tile)</label>
                      <input
                        type="number"
                        value={zone.portalSpawnY ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const action: Parameters<typeof EditorService.dispatch>[0] = val
                            ? { type: 'UPDATE_ZONE_PORTAL', index: idx, portalSpawnY: Number(val) }
                            : { type: 'UPDATE_ZONE_PORTAL', index: idx };
                          EditorService.dispatch(action);
                        }}
                        placeholder="auto"
                        style={{
                          padding: 4,
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--glass)',
                          color: 'var(--fg)',
                          fontSize: 11,
                          width: '100%',
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
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
                    EditorService.dispatch({ type: 'MARK_ZONES_MODIFIED' });
                    // Auto-save nach Löschen, damit Server-State synchron bleibt
                    if (onSave) {
                      await onSave();
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
          );
        })}
      </div>
    </>
  );
}
