import React from 'react';
import { EditorService, MapObjectRecord } from '../../services/EditorService';

type ObjectPropertiesPanelProps = {
  object: MapObjectRecord;
};

export function ObjectPropertiesPanel({ object }: ObjectPropertiesPanelProps) {
  const [tileX, setTileX] = React.useState(object.tileX);
  const [tileY, setTileY] = React.useState(object.tileY);
  const [zIndex, setZIndex] = React.useState(object.zIndex || 0);
  const [rotation, setRotation] = React.useState(object.rotation || 0);
  const [flipX, setFlipX] = React.useState(object.flipX || false);
  const [flipY, setFlipY] = React.useState(object.flipY || false);

  // Sync when different object is selected
  React.useEffect(() => {
    setTileX(object.tileX);
    setTileY(object.tileY);
    setZIndex(object.zIndex || 0);
    setRotation(object.rotation || 0);
    setFlipX(object.flipX || false);
    setFlipY(object.flipY || false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: form state is a local working copy that should only re-sync when the user selects a different object; depending on the individual fields would overwrite in-flight user input on every dispatch
  }, [object.id]);

  const handleApply = () => {
    EditorService.dispatch({
      type: 'ADD_PENDING_OBJECT_UPDATE',
      objectId: object.id,
      updates: { tileX, tileY, zIndex, rotation, flipX, flipY },
    });
  };

  const handleDelete = () => {
    EditorService.dispatch({
      type: 'ADD_PENDING_OBJECT_DELETE',
      objectId: object.id,
    });
    EditorService.dispatch({
      type: 'SELECT_MAP_OBJECT',
      objectId: null,
    });
  };

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>Objekt-Eigenschaften</div>
      <ObjectInfo object={object} />
      <EditableFields
        tileX={tileX}
        setTileX={setTileX}
        tileY={tileY}
        setTileY={setTileY}
        zIndex={zIndex}
        setZIndex={setZIndex}
        rotation={rotation}
        setRotation={setRotation}
      />
      <FlipToggles flipX={flipX} setFlipX={setFlipX} flipY={flipY} setFlipY={setFlipY} />
      <ActionButtons onApply={handleApply} onDelete={handleDelete} />
    </div>
  );
}

/* --- Sub-Components --- */

function ObjectInfo({ object }: { object: MapObjectRecord }) {
  return (
    <div style={infoStyle}>
      <div>ID: #{String(object.id)}</div>
      <div>Item: {object.itemId}</div>
      <div>Pack: {object.assetPackUuid}</div>
      <div>Kategorie: {object.category}</div>
      <div>
        Gr&ouml;&szlig;e: {object.width}x{object.height}
      </div>
      <div>Kollision: {object.collide ? 'Ja' : 'Nein'}</div>
    </div>
  );
}

type EditableFieldsProps = {
  tileX: number;
  setTileX: (v: number) => void;
  tileY: number;
  setTileY: (v: number) => void;
  zIndex: number;
  setZIndex: (v: number) => void;
  rotation: number;
  setRotation: (v: number) => void;
};

function EditableFields(props: EditableFieldsProps) {
  const { tileX, setTileX, tileY, setTileY, zIndex, setZIndex, rotation, setRotation } = props;
  return (
    <div style={gridStyle}>
      <NumberField label="Tile X" value={tileX} onChange={setTileX} />
      <NumberField label="Tile Y" value={tileY} onChange={setTileY} />
      <NumberField label="Z-Index" value={zIndex} onChange={setZIndex} />
      <NumberField label="Rotation" value={rotation} onChange={setRotation} step={90} />
    </div>
  );
}

type NumberFieldProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
};

function NumberField({ label, value, onChange, step }: NumberFieldProps) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        step={step}
        style={inputStyle}
      />
    </div>
  );
}

type FlipTogglesProps = {
  flipX: boolean;
  setFlipX: (v: boolean) => void;
  flipY: boolean;
  setFlipY: (v: boolean) => void;
};

function FlipToggles({ flipX, setFlipX, flipY, setFlipY }: FlipTogglesProps) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <label style={checkboxLabelStyle}>
        <input type="checkbox" checked={flipX} onChange={(e) => setFlipX(e.target.checked)} /> Flip X
      </label>
      <label style={checkboxLabelStyle}>
        <input type="checkbox" checked={flipY} onChange={(e) => setFlipY(e.target.checked)} /> Flip Y
      </label>
    </div>
  );
}

type ActionButtonsProps = {
  onApply: () => void;
  onDelete: () => void;
};

function ActionButtons({ onApply, onDelete }: ActionButtonsProps) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={onApply} style={applyBtnStyle}>
        &Uuml;bernehmen
      </button>
      <button onClick={onDelete} style={deleteBtnStyle}>
        L&ouml;schen
      </button>
    </div>
  );
}

/* --- Styles --- */

const containerStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--glass)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--fg)',
};

const infoStyle: React.CSSProperties = {
  display: 'grid',
  gap: 2,
  fontSize: 11,
  color: 'var(--fg-subtle)',
  fontFamily: 'monospace',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-subtle)',
};

const inputStyle: React.CSSProperties = {
  padding: 4,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--glass)',
  color: 'var(--fg)',
  fontSize: 12,
  width: '100%',
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  alignItems: 'center',
  fontSize: 12,
  color: 'var(--fg)',
};

const applyBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'rgba(59,130,246,0.18)',
  color: 'var(--fg)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

const deleteBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'rgba(239,68,68,0.12)',
  color: 'var(--fg)',
  fontSize: 12,
  cursor: 'pointer',
};
