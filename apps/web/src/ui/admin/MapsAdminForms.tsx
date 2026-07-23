import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const num = (e: React.ChangeEvent<HTMLInputElement>) => Number(e.target.value) || 0;
  return (
    <Card title={t('admin.maps.createTitle')} style={{ padding: 12 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Select
              options={tenantOptions}
              value={value.tenantId}
              onChange={(v) => onChange({ ...value, tenantId: v })}
              placeholder={t('admin.maps.pickTenant')}
            />
          </div>
          <Input
            placeholder={t('admin.maps.mapNamePlaceholder')}
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input
            type="number"
            placeholder={t('admin.maps.fieldWidth')}
            value={value.width}
            onChange={(e) => onChange({ ...value, width: num(e) })}
            style={{ width: 110 }}
          />
          <Input
            type="number"
            placeholder={t('admin.maps.fieldHeight')}
            value={value.height}
            onChange={(e) => onChange({ ...value, height: num(e) })}
            style={{ width: 110 }}
          />
          <Input
            type="number"
            placeholder={t('admin.maps.fieldTileW')}
            value={value.tileWidth}
            onChange={(e) => onChange({ ...value, tileWidth: num(e) })}
            style={{ width: 110 }}
          />
          <Input
            type="number"
            placeholder={t('admin.maps.fieldTileH')}
            value={value.tileHeight}
            onChange={(e) => onChange({ ...value, tileHeight: num(e) })}
            style={{ width: 110 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={onSubmit} disabled={submitting}>
            {submitting ? t('admin.maps.creating') : t('admin.maps.createSubmit')}
          </Button>
          <Button onClick={onCancel}>{t('admin.maps.cancel')}</Button>
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
  const { t } = useTranslation();
  return (
    <Card title={t('admin.maps.importTitle')} style={{ padding: 12 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Select
              options={tenantOptions}
              value={value.tenantId}
              onChange={(v) => onChange({ ...value, tenantId: v })}
              placeholder={t('admin.maps.pickTenant')}
            />
          </div>
          <Input
            placeholder={t('admin.maps.mapNamePlaceholder')}
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={onPickFile} disabled={submitting}>
            {submitting ? t('admin.maps.importing') : t('admin.maps.pickFileAndImport')}
          </Button>
          <Button onClick={onCancel}>{t('admin.maps.cancel')}</Button>
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
  const { t } = useTranslation();
  return (
    <Card title={t('admin.maps.copyTitle', { name: dialog.mapName })} style={{ padding: 12 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Select
              options={tenantOptions}
              value={dialog.targetTenantId}
              onChange={(v) => onChange({ targetTenantId: v })}
              placeholder={t('admin.maps.targetTenantPlaceholder')}
            />
          </div>
          <Input
            placeholder={t('admin.maps.newNameOptional')}
            value={dialog.newName}
            onChange={(e) => onChange({ newName: e.target.value })}
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={onSubmit}>
            {t('admin.maps.copySubmit')}
          </Button>
          <Button onClick={onCancel}>{t('admin.maps.cancel')}</Button>
        </div>
      </div>
    </Card>
  );
}
