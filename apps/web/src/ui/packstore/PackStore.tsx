import React from 'react';
import { Modal, Button, Tabs } from '../system';
import type { TabItem } from '../system';
import { openExternal } from '../../lib/openExternal';
import { PackCard } from './PackCard';
import type { CatalogPack } from './packStoreTypes';

const storeTabs: TabItem[] = [
  { key: 'store', label: 'Store' },
  { key: 'my-packs', label: 'My Packs' },
];

interface PackStoreProps {
  apiBase: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function useCatalog(apiBase: string, open: boolean) {
  const [catalog, setCatalog] = React.useState<CatalogPack[]>([]);
  const [myPacks, setMyPacks] = React.useState<CatalogPack[]>([]);
  const [loading, setLoading] = React.useState(false);

  const loadCatalog = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/pack-store/catalog`, { credentials: 'include' });
      if (res.ok) setCatalog(await res.json());
    } catch { /* handled by UI */ }
    setLoading(false);
  }, [apiBase]);

  const loadMyPacks = React.useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/pack-store/my-packs`, { credentials: 'include' });
      if (res.ok) setMyPacks(await res.json());
    } catch { /* handled by UI */ }
  }, [apiBase]);

  React.useEffect(() => {
    if (!open) return;
    void loadCatalog();
    void loadMyPacks();
  }, [open, loadCatalog, loadMyPacks]);

  return { catalog, myPacks, loading, reload: () => { void loadCatalog(); void loadMyPacks(); } };
}

export function PackStore({ apiBase, open, onOpenChange }: PackStoreProps) {
  const [tab, setTab] = React.useState<'store' | 'my-packs'>('store');
  const { catalog, myPacks, loading, reload } = useCatalog(apiBase, open);

  const handleInstall = async (packUuid: string, packType: 'asset' | 'avatar') => {
    try {
      const res = await fetch(`${apiBase}/pack-store/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ packUuid, packType }),
      });
      if (res.ok) reload();
    } catch { /* handled by UI */ }
  };

  const handleBuy = async (packUuid: string, packType: 'asset' | 'avatar') => {
    try {
      const res = await fetch(`${apiBase}/pack-store/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ packUuid, packType }),
      });
      if (res.ok) {
        const data: { url: string } = await res.json();
        await openExternal(data.url);
      }
    } catch { /* handled by UI */ }
  };

  const sortedCatalog = React.useMemo(() => {
    return [...catalog].sort((a, b) => {
      if (a.catalog.featured && !b.catalog.featured) return -1;
      if (!a.catalog.featured && b.catalog.featured) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [catalog]);

  const activePacks = tab === 'store' ? sortedCatalog : myPacks;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Pack Store"
      maxWidth={900}
      actions={<Button onClick={reload}>{loading ? 'Loading...' : 'Reload'}</Button>}
      accessories={<Tabs items={storeTabs} activeKey={tab} onChange={setTab as (key: string) => void} />}
    >
      {loading && activePacks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--fg-subtle)' }}>Loading packs...</div>
      ) : activePacks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--fg-subtle)' }}>
          {tab === 'store' ? 'No packs available yet.' : 'No packs installed yet.'}
        </div>
      ) : (
        <div style={gridStyle}>
          {activePacks.map(p => (
            <PackCard key={`${p.packType}-${p.uuid}`} pack={p} onInstall={handleInstall} onBuy={handleBuy} />
          ))}
        </div>
      )}
    </Modal>
  );
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 12,
};
