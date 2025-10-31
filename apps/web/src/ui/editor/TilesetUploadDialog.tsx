import { Modal, Button, Input, Select } from '../../ui/system';
import { TilesetPreview } from './TilesetPreview';
import { useTranslation } from 'react-i18next';

export type UploadDialogState = {
  open: boolean;
  dataUrl: string;
  fileName: string;
  tileWidth: number;
  tileHeight: number;
  margin: number;
  spacing: number;
  category?: 'terrain' | 'structures' | 'objects';
};

export function TilesetUploadDialog(props: {
  open: boolean;
  dialog: UploadDialogState;
  onCancel: () => void;
  onConfirm: (tileset: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin: number; spacing: number; category?: 'terrain' | 'structures' | 'objects' }) => void;
  setDialog: (next: UploadDialogState | null) => void;
}) {
  const d = props.dialog;
  const { t } = useTranslation();
  const previewTileset = { key: 'uploading', dataUrl: d.dataUrl, tileWidth: d.tileWidth, tileHeight: d.tileHeight, margin: d.margin, spacing: d.spacing };

  return (
    <Modal
      open={props.open}
      onOpenChange={(v)=> { if (!v) props.onCancel(); }}
      title={`${t('tileset.configureTitle', { file: d.fileName })}`}
      maxWidth={800}
      footer={(
        <>
          <Button onClick={props.onCancel}>{t('tileset.cancel')}</Button>
          <Button variant="brand" onClick={() => {
            const base = {
              key: `tileset-${Date.now()}`,
              dataUrl: d.dataUrl,
              tileWidth: d.tileWidth,
              tileHeight: d.tileHeight,
              margin: d.margin,
              spacing: d.spacing,
            } as const;
            const tileset = (d.category ? { ...base, category: d.category } : base);
            props.onConfirm(tileset as { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin: number; spacing: number; category?: 'terrain' | 'structures' | 'objects' });
          }}>{t('tileset.add')}</Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 8 }}>{t('tileset.preview')}</div>
            <div style={{ maxHeight: 400, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--glass)', padding: 16 }}>
              <TilesetPreview tileset={previewTileset} selectedIndex={-1} onSelect={() => {}} />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{t('tileset.settings')}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('tileset.width')}</label>
              <Input type="number" min={8} max={256} value={d.tileWidth} onChange={(e) => props.setDialog({ ...d, tileWidth: parseInt((e.target as HTMLInputElement).value) || 16 })} style={{ padding: '8px 12px', fontSize: 13 }} />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('tileset.height')}</label>
              <Input type="number" min={8} max={256} value={d.tileHeight} onChange={(e) => props.setDialog({ ...d, tileHeight: parseInt((e.target as HTMLInputElement).value) || 16 })} style={{ padding: '8px 12px', fontSize: 13 }} />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('tileset.margin')}</label>
              <Input type="number" min={0} max={64} value={d.margin} onChange={(e) => props.setDialog({ ...d, margin: parseInt((e.target as HTMLInputElement).value) || 0 })} style={{ padding: '8px 12px', fontSize: 13 }} />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('tileset.spacing')}</label>
              <Input type="number" min={0} max={64} value={d.spacing} onChange={(e) => props.setDialog({ ...d, spacing: parseInt((e.target as HTMLInputElement).value) || 0 })} style={{ padding: '8px 12px', fontSize: 13 }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 8 }}>{t('tileset.hint')}</div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('tileset.category')}</label>
              <Select value={d.category || 'terrain'} onChange={(e) => props.setDialog({ ...d, category: (e.target as HTMLSelectElement).value as any })} style={{ padding: '8px 12px', fontSize: 13 }}>
                <option value="terrain">{t('tileset.cat.terrain')}</option>
                <option value="structures">{t('tileset.cat.structures')}</option>
                <option value="objects">{t('tileset.cat.objects')}</option>
              </Select>
              <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{t('tileset.categoryHint')}</div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}


