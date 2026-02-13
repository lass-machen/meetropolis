import React from 'react';
import { Button } from '../system';
import { PackCatalogTable } from './PackCatalogTable';
import { PackGrantModal } from './PackGrantModal';
import type { PackWithCatalog } from '../packstore/packStoreTypes';

interface PackCatalogAdminProps {
  apiBase: string;
}

export function PackCatalogAdmin({ apiBase }: PackCatalogAdminProps) {
  const [activeTab, setActiveTab] = React.useState<'asset' | 'avatar'>('asset');
  const [packs, setPacks] = React.useState<PackWithCatalog[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [grantTarget, setGrantTarget] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/pack-catalog/${activeTab}-packs`, { credentials: 'include' });
      if (res.ok) setPacks(await res.json());
    } catch { /* handled by UI */ }
    setLoading(false);
  }, [apiBase, activeTab]);

  React.useEffect(() => { void load(); }, [load]);

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
      </div>

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
