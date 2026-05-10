/**
 * ZoneEditor - Zone-Bearbeitungs-UI Komponente
 *
 * Extrahiert aus EditorPanel.tsx zur Einhaltung des 600 LoC Budgets.
 */

import { useTranslation } from 'react-i18next';
import { EditorService } from '../../services/EditorService';
import { useMapStore } from '../../state/mapStore';
import type { Zone, EditorTool } from '../../services/EditorTypes';

type SaveFn = (() => Promise<boolean>) | undefined;

function ZoneEditorHeader({ onSave, t }: { onSave: SaveFn; t: (k: string) => string }) {
  const handleSave = async () => {
    if (!onSave) return;
    const saved = await onSave();
    if (saved) {
      try {
        window.dispatchEvent(
          new CustomEvent('editor:toast', {
            detail: { title: t('editor.savedTitle'), description: t('editor.zonesSaved'), intent: 'success' },
          }),
        );
      } catch {}
    }
  };
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('editor.zones')}</div>
      <button
        onClick={() => {
          void handleSave();
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
  );
}

function ZoneNameInput({ zoneName, tool, t }: { zoneName: string; tool: EditorTool; t: (k: string) => string }) {
  return (
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
  );
}

function PortalSpawnInput({
  value,
  idx,
  label,
  key,
}: {
  value: number | undefined;
  idx: number;
  label: string;
  key: 'portalSpawnX' | 'portalSpawnY';
}) {
  return (
    <div style={{ flex: 1, display: 'grid', gap: 2 }}>
      <label style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{label}</label>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => {
          const val = e.target.value;
          const action: Parameters<typeof EditorService.dispatch>[0] = val
            ? ({ type: 'UPDATE_ZONE_PORTAL', index: idx, [key]: Number(val) } as any)
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
  );
}

function ZonePortalFields({ zone, idx }: { zone: Zone; idx: number }) {
  const availableMaps = useMapStore.getState().availableMaps;
  return (
    <div style={{ display: 'grid', gap: 4, padding: '6px 0 0' }}>
      <label htmlFor={`zone-portal-target-${idx}`} style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
        Ziel-Map
      </label>
      <select
        id={`zone-portal-target-${idx}`}
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
        {availableMaps.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 6 }}>
        <PortalSpawnInput value={zone.portalSpawnX} idx={idx} label="Spawn X (Tile)" key="portalSpawnX" />
        <PortalSpawnInput value={zone.portalSpawnY} idx={idx} label="Spawn Y (Tile)" key="portalSpawnY" />
      </div>
    </div>
  );
}

function ZoneCard({
  zone,
  idx,
  editingZoneIndex,
  onSave,
  t,
}: {
  zone: Zone;
  idx: number;
  editingZoneIndex: number | null;
  onSave: SaveFn;
  t: (k: string) => string;
}) {
  return (
    <div
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
        <label htmlFor={`zone-name-${idx}`} style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
          {t('editor.name')}
        </label>
        <input
          id={`zone-name-${idx}`}
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
      <div style={{ display: 'grid', gap: 4 }}>
        <label htmlFor={`zone-type-${idx}`} style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
          Typ
        </label>
        <select
          id={`zone-type-${idx}`}
          value={zone.type || 'default'}
          onChange={(e) =>
            EditorService.dispatch({
              type: 'UPDATE_ZONE_TYPE',
              index: idx,
              zoneType: e.target.value as 'default' | 'portal',
            })
          }
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
      {zone.type === 'portal' && <ZonePortalFields zone={zone} idx={idx} />}
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
          onClick={() => {
            void (async () => {
              EditorService.dispatch({ type: 'DELETE_ZONE', index: idx });
              EditorService.dispatch({ type: 'MARK_ZONES_MODIFIED' });
              if (onSave) await onSave();
            })();
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
}

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
      <ZoneEditorHeader onSave={onSave} t={t} />
      <ZoneNameInput zoneName={zoneName} tool={tool} t={t} />
      <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.existingZones')}</div>
        {zones.length === 0 && <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('editor.noZones')}</div>}
        {zones.map((zone, idx) => (
          <ZoneCard key={idx} zone={zone} idx={idx} editingZoneIndex={editingZoneIndex} onSave={onSave} t={t} />
        ))}
      </div>
    </>
  );
}
