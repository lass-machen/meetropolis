import React from 'react';
import {
  Button,
  Input,
  NavBar,
  Tabs,
  ChevronLeftIcon,
} from '../system';
import type { TabItem } from '../system';
import type { AdminCapabilities } from '../../app/routes/hooks/useFetchMe';
import { openExternal } from '../../lib/openExternal';
import { logger } from '../../lib/logger';
import { TenantUsersPanel } from './TenantUsersPanel';
import { TenantBillingPanel } from './TenantBillingPanel';
import { TenantPacksPanel } from './TenantPacksPanel';
import { TenantListTable } from './TenantListTable';

export type AvailablePlan = {
  priceId: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
  concurrentLimit: number;
};

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  concurrentLimit: number;
  freeSeats?: number;
  bypassLimits: boolean;
  isInternal: boolean;
  status: string | null;
  defaultMapName?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  createdAt: string;
  updatedAt: string;
  online: number;
};

type Screen =
  | { type: 'list' }
  | { type: 'detail'; tenant: TenantRow };

type DetailTab = 'users' | 'billing' | 'packs';

export function TenantsAdmin(props: { apiBase: string; capabilities: AdminCapabilities }) {
  const { apiBase, capabilities } = props;
  const data = useTenantsData(apiBase);
  const [screen, setScreen] = React.useState<Screen>({ type: 'list' });
  const [detailTab, setDetailTab] = React.useState<DetailTab>('users');

  const openDetail = React.useCallback((tenant: TenantRow) => {
    setDetailTab('users');
    setScreen({ type: 'detail', tenant });
  }, []);

  if (screen.type === 'detail') {
    return (
      <TenantDetailScreen
        apiBase={apiBase}
        tenant={screen.tenant}
        activeTab={detailTab}
        onChangeTab={setDetailTab}
        onBack={() => setScreen({ type: 'list' })}
        capabilities={capabilities}
      />
    );
  }

  return <TenantListScreen apiBase={apiBase} data={data} onOpenDetail={openDetail} />;
}

interface TenantsData {
  rows: TenantRow[];
  loading: boolean;
  plans: AvailablePlan[];
  load: () => Promise<void>;
  updateRow: (id: string, patch: Partial<TenantRow>) => void;
  saveRow: (row: TenantRow) => Promise<void>;
  createTenant: (slug: string, name: string) => Promise<boolean>;
  deleteTenant: (id: string) => Promise<void>;
}

async function fetchTenants(apiBase: string): Promise<TenantRow[] | null> {
  try {
    const res = await fetch(`${apiBase}/admin/tenants`, { credentials: 'include' });
    if (res.ok) return (await res.json()) as TenantRow[];
  } catch (err) {
    logger.warn('[TenantsAdmin] Failed to load tenants', err);
  }
  return null;
}

async function fetchPlans(apiBase: string): Promise<AvailablePlan[] | null> {
  try {
    const res = await fetch(`${apiBase}/billing/plans`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      return (data.plans || []) as AvailablePlan[];
    }
  } catch (err) {
    logger.warn('[TenantsAdmin] Failed to load plans', err);
  }
  return null;
}

async function patchTenant(apiBase: string, r: TenantRow): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/admin/tenants/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: r.name,
        concurrentLimit: r.concurrentLimit,
        freeSeats: r.freeSeats ?? 0,
        bypassLimits: r.bypassLimits,
        status: r.status ?? undefined,
        defaultMapName: r.defaultMapName ?? undefined,
      }),
    });
    return res.ok;
  } catch (err) {
    logger.warn('[TenantsAdmin] Failed to save tenant', err);
    return false;
  }
}

async function postTenant(apiBase: string, slug: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/admin/tenants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ slug, name, freeSeats: 3 }),
    });
    return res.ok;
  } catch (err) {
    logger.warn('[TenantsAdmin] Failed to create tenant', err);
    return false;
  }
}

async function deleteTenantRequest(apiBase: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/admin/tenants/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok;
  } catch (err) {
    logger.warn('[TenantsAdmin] Failed to delete tenant', err);
    return false;
  }
}

function useTenantsData(apiBase: string): TenantsData {
  const [rows, setRows] = React.useState<TenantRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [plans, setPlans] = React.useState<AvailablePlan[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    const [nextRows, nextPlans] = await Promise.all([fetchTenants(apiBase), fetchPlans(apiBase)]);
    if (nextRows) setRows(nextRows);
    if (nextPlans) setPlans(nextPlans);
    setLoading(false);
  }, [apiBase]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const updateRow = React.useCallback((id: string, patch: Partial<TenantRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? ({ ...r, ...patch } as TenantRow) : r)));
  }, []);

  const saveRow = React.useCallback(
    async (r: TenantRow) => {
      if (await patchTenant(apiBase, r)) await load();
    },
    [apiBase, load],
  );

  const createTenant = React.useCallback(
    async (slug: string, name: string): Promise<boolean> => {
      const cleanSlug = slug.trim().toLowerCase();
      const cleanName = name.trim();
      if (!cleanSlug || !cleanName) return false;
      const ok = await postTenant(apiBase, cleanSlug, cleanName);
      if (ok) await load();
      return ok;
    },
    [apiBase, load],
  );

  const deleteTenant = React.useCallback(
    async (id: string) => {
      if (await deleteTenantRequest(apiBase, id)) await load();
    },
    [apiBase, load],
  );

  return { rows, loading, plans, load, updateRow, saveRow, createTenant, deleteTenant };
}

interface TenantDetailScreenProps {
  apiBase: string;
  tenant: TenantRow;
  activeTab: DetailTab;
  onChangeTab: (tab: DetailTab) => void;
  onBack: () => void;
  capabilities: AdminCapabilities;
}

function TenantDetailScreen({
  apiBase,
  tenant,
  activeTab,
  onChangeTab,
  onBack,
  capabilities,
}: TenantDetailScreenProps) {
  const detailTabs = React.useMemo<TabItem[]>(() => {
    const tabs: TabItem[] = [{ key: 'users', label: 'Benutzer' }];
    if (capabilities.hasBilling) {
      tabs.push({ key: 'billing', label: 'Billing' });
    }
    if (capabilities.hasAdminEnterprise) {
      tabs.push({ key: 'packs', label: 'Packs' });
    }
    return tabs;
  }, [capabilities]);

  // Fallback: wenn aktiver Tab durch Capability-Change verschwindet
  React.useEffect(() => {
    if (!detailTabs.some((t) => t.key === activeTab)) {
      onChangeTab((detailTabs[0]?.key as DetailTab) || 'users');
    }
  }, [detailTabs, activeTab, onChangeTab]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <NavBar
        left={
          <Button iconOnly size="sm" variant="ghost" onClick={onBack} aria-label="Zurück">
            <ChevronLeftIcon />
          </Button>
        }
        title={
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ fontWeight: 600 }}>{tenant.name}</span>
            <span style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{tenant.slug}</span>
          </div>
        }
      />
      <Tabs
        items={detailTabs}
        activeKey={activeTab}
        onChange={(key) => onChangeTab(key as DetailTab)}
      />
      {activeTab === 'users' && <TenantUsersPanel apiBase={apiBase} tenantId={tenant.id} />}
      {activeTab === 'billing' && <TenantBillingPanel apiBase={apiBase} tenantId={tenant.id} />}
      {activeTab === 'packs' && <TenantPacksPanel apiBase={apiBase} tenantId={tenant.id} />}
    </div>
  );
}

interface TenantListScreenProps {
  apiBase: string;
  data: TenantsData;
  onOpenDetail: (tenant: TenantRow) => void;
}

async function openCheckoutSession(apiBase: string, priceId: string): Promise<void> {
  if (!priceId) return;
  try {
    const res = await fetch(`${apiBase}/billing/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ priceId }),
    });
    if (res.ok) {
      const { url } = await res.json();
      await openExternal(url);
    }
  } catch (err) {
    logger.warn('[TenantsAdmin] Failed to start checkout', err);
  }
}

async function openPortalSession(apiBase: string): Promise<void> {
  try {
    const res = await fetch(`${apiBase}/billing/portal-session`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) {
      const { url } = await res.json();
      await openExternal(url);
    }
  } catch (err) {
    logger.warn('[TenantsAdmin] Failed to open portal', err);
  }
}

function TenantListScreen({ apiBase, data, onOpenDetail }: TenantListScreenProps) {
  const { rows, loading, plans, load, updateRow, saveRow, createTenant, deleteTenant } = data;
  const [createSlug, setCreateSlug] = React.useState('');
  const [createName, setCreateName] = React.useState('');
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!deletingId) return;
    const timer = setTimeout(() => setDeletingId(null), 3000);
    return () => clearTimeout(timer);
  }, [deletingId]);

  const handleCreate = async () => {
    const ok = await createTenant(createSlug, createName);
    if (ok) {
      setCreateSlug('');
      setCreateName('');
    }
  };

  const handleDelete = async (id: string) => {
    await deleteTenant(id);
    setDeletingId(null);
  };

  const onCheckout = (priceId: string) => void openCheckoutSession(apiBase, priceId);
  const onPortal = () => void openPortalSession(apiBase);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <TenantCreateBar
        createSlug={createSlug}
        createName={createName}
        loading={loading}
        onChangeSlug={setCreateSlug}
        onChangeName={setCreateName}
        onCreate={handleCreate}
        onReload={load}
      />
      <TenantListTable
        rows={rows}
        loading={loading}
        plans={plans}
        deletingId={deletingId}
        onArmDelete={setDeletingId}
        onConfirmDelete={handleDelete}
        onUpdate={updateRow}
        onSave={saveRow}
        onOpenDetail={onOpenDetail}
        onCheckout={onCheckout}
        onPortal={onPortal}
      />
    </div>
  );
}

interface TenantCreateBarProps {
  createSlug: string;
  createName: string;
  loading: boolean;
  onChangeSlug: (value: string) => void;
  onChangeName: (value: string) => void;
  onCreate: () => void;
  onReload: () => void;
}

function TenantCreateBar({
  createSlug,
  createName,
  loading,
  onChangeSlug,
  onChangeName,
  onCreate,
  onReload,
}: TenantCreateBarProps) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Input
        value={createSlug}
        onChange={(e) => onChangeSlug(e.target.value)}
        placeholder="slug"
        style={{ width: 180 }}
      />
      <Input
        value={createName}
        onChange={(e) => onChangeName(e.target.value)}
        placeholder="name"
        style={{ width: 220 }}
      />
      <Button onClick={() => onCreate()}>Neu anlegen</Button>
      <div style={{ flex: 1 }} />
      <Button onClick={() => onReload()}>{loading ? 'Lade…' : 'Neu laden'}</Button>
    </div>
  );
}
