import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../system';
import { PackCatalogTable } from './PackCatalogTable';
import { PackGrantModal } from './PackGrantModal';
import type { PackWithCatalog } from '../packstore/packStoreTypes';

interface PackCatalogAdminProps {
  apiBase: string;
}

export function PackCatalogAdmin({ apiBase }: PackCatalogAdminProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = React.useState<'asset' | 'avatar'>('asset');
  const [packs, setPacks] = React.useState<PackWithCatalog[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [grantTarget, setGrantTarget] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadStatus, setUploadStatus] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/pack-catalog/${activeTab}-packs`, { credentials: 'include' });
      if (res.ok) setPacks(await res.json());
    } catch { /* handled by UI */ }
    setLoading(false);
  }, [apiBase, activeTab]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (uploadStatus?.type !== 'success') return;
    const timer = setTimeout(() => setUploadStatus(null), 5000);
    return () => clearTimeout(timer);
  }, [uploadStatus]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.mepack') && !file.name.endsWith('.zip')) {
      setUploadStatus({ type: 'error', message: t('admin.packCatalog.invalidFile') });
      e.target.value = '';
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setUploadStatus({ type: 'error', message: t('admin.packCatalog.fileTooLarge') });
      e.target.value = '';
      return;
    }

    setUploading(true);
    setUploadStatus(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${apiBase}/asset-packs/upload`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (res.ok) {
        setUploadStatus({ type: 'success', message: t('admin.packCatalog.uploadSuccess') });
        void load();
      } else {
        const data = await res.json().catch(() => null);
        let msg = data?.error || t('admin.packCatalog.uploadError');
        if (data?.reason) {
          msg += ' — ' + data.reason;
          if (data.itemId) msg += ` (Item: ${data.itemId})`;
        } else if (Array.isArray(data?.details)) {
          const detail = data.details.map((d: any) => `${d.path?.join('.') || '?'}: ${d.message}`).slice(0, 5).join('; ');
          msg += ' — ' + detail;
        }
        setUploadStatus({ type: 'error', message: msg });
      }
    } catch {
      setUploadStatus({ type: 'error', message: t('admin.packCatalog.uploadError') });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button onClick={() => setActiveTab('asset')} variant={activeTab === 'asset' ? 'primary' : 'secondary'}>
          Asset Packs
        </Button>
        <Button onClick={() => setActiveTab('avatar')} variant={activeTab === 'avatar' ? 'primary' : 'secondary'}>
          Avatar Packs
        </Button>
        <div style={{ flex: 1 }} />
        <Button onClick={() => load()}>{loading ? 'Loading...' : 'Reload'}</Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mepack,.zip,application/zip,application/x-zip-compressed,application/octet-stream"
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
        <Button
          variant="primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? t('admin.packCatalog.uploading') : t('admin.packCatalog.upload')}
        </Button>
      </div>

      {uploadStatus && (
        <div style={{ fontSize: 13, color: uploadStatus.type === 'success' ? 'green' : '#e53e3e' }}>
          {uploadStatus.message}
        </div>
      )}

      {loading && packs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-subtle)' }}>Loading packs...</div>
      ) : packs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-subtle)' }}>No {activeTab} packs found.</div>
      ) : (
        <PackCatalogTable
          apiBase={apiBase}
          packType={activeTab}
          packs={packs}
          onReload={load}
          onGrant={(uuid) => setGrantTarget(uuid)}
        />
      )}

      <PackGrantModal
        apiBase={apiBase}
        open={!!grantTarget}
        onOpenChange={(v) => { if (!v) setGrantTarget(null); }}
        packUuid={grantTarget ?? ''}
        packType={activeTab}
        onGranted={load}
      />
    </div>
  );
}
