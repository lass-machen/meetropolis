import React from 'react';
import { Button, Input, Select, Card } from '../system';

export type TenantSelectOption = { value: string; label: string };

export type NewMapForm = {
  tenantId: string;
  name: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
};

export type ImportForm = { tenantId: string; name: string };

export type CopyDialogState = {
  mapId: string;
  mapName: string;
  targetTenantId: string;
  newName: string;
};

type CreateFormProps = {
  tenantOptions: TenantSelectOption[];
  value: NewMapForm;
  onChange: (next: NewMapForm) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
};

export function CreateMapForm(props: CreateFormProps) {
  const { tenantOptions, value, onChange, onSubmit, onCancel, submitting } = props;
  const num = (e: React.ChangeEvent<HTMLInputElement>) => Number(e.target.value) || 0;
  return (
    <Card title="Neue Map erstellen" style={{ padding: 12 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Select
              options={tenantOptions}
              value={value.tenantId}
              onChange={(v) => onChange({ ...value, tenantId: v })}
              placeholder="— Tenant wählen —"
            />
          </div>
          <Input
            placeholder="Map-Name"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input type="number" placeholder="Width" value={value.width} onChange={(e) => onChange({ ...value, width: num(e) })} style={{ width: 110 }} />
          <Input type="number" placeholder="Height" value={value.height} onChange={(e) => onChange({ ...value, height: num(e) })} style={{ width: 110 }} />
          <Input type="number" placeholder="TileW" value={value.tileWidth} onChange={(e) => onChange({ ...value, tileWidth: num(e) })} style={{ width: 110 }} />
          <Input type="number" placeholder="TileH" value={value.tileHeight} onChange={(e) => onChange({ ...value, tileHeight: num(e) })} style={{ width: 110 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={onSubmit} disabled={submitting}>
            {submitting ? 'Erstelle…' : 'Map anlegen'}
          </Button>
          <Button onClick={onCancel}>Abbrechen</Button>
        </div>
      </div>
    </Card>
  );
}

type ImportFormProps = {
  tenantOptions: TenantSelectOption[];
  value: ImportForm;
  onChange: (next: ImportForm) => void;
  onPickFile: () => void;
  onCancel: () => void;
  submitting: boolean;
};

export function ImportMapForm(props: ImportFormProps) {
  const { tenantOptions, value, onChange, onPickFile, onCancel, submitting } = props;
  return (
    <Card title="Map importieren (Tiled JSON)" style={{ padding: 12 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Select
              options={tenantOptions}
              value={value.tenantId}
              onChange={(v) => onChange({ ...value, tenantId: v })}
              placeholder="— Tenant wählen —"
            />
          </div>
          <Input
            placeholder="Map-Name"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={onPickFile} disabled={submitting}>
            {submitting ? 'Importiere…' : 'Datei wählen & importieren'}
          </Button>
          <Button onClick={onCancel}>Abbrechen</Button>
        </div>
      </div>
    </Card>
  );
}

type CopyFormProps = {
  tenantOptions: TenantSelectOption[];
  dialog: CopyDialogState;
  onChange: (patch: Partial<CopyDialogState>) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function CopyMapForm(props: CopyFormProps) {
  const { tenantOptions, dialog, onChange, onSubmit, onCancel } = props;
  return (
    <Card title={`Map "${dialog.mapName}" kopieren`} style={{ padding: 12 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Select
              options={tenantOptions}
              value={dialog.targetTenantId}
              onChange={(v) => onChange({ targetTenantId: v })}
              placeholder="— Ziel-Tenant —"
            />
          </div>
          <Input
            placeholder="Neuer Name (optional)"
            value={dialog.newName}
            onChange={(e) => onChange({ newName: e.target.value })}
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={onSubmit}>Kopieren</Button>
          <Button onClick={onCancel}>Abbrechen</Button>
        </div>
      </div>
    </Card>
  );
}
