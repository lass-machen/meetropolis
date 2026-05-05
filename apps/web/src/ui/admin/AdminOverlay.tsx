import React from 'react';
import { Modal, Tabs } from '../system';
import type { TabItem } from '../system';
import type { AdminCapabilities } from '../../app/routes/hooks/useFetchMe';
import { AdminHealthDashboard } from './AdminHealthDashboard';
import { MapsAdmin } from './MapsAdmin';
import { SettingsAdmin } from './SettingsAdmin';
import { getEnterpriseWebModule } from '../../lib/enterpriseWebLoader';

type OssTabKey = 'maps' | 'health' | 'settings' | 'enterprise';

type EnterpriseTabsProps = { apiBase: string; capabilities: AdminCapabilities };

const EnterpriseFallback: React.ComponentType<EnterpriseTabsProps> = () => (
  <div style={{ padding: 24, color: '#666' }}>
    Enterprise admin features (Mandanten, Billing, Pricing, Pack Catalog,
    Audit Log) are not available in the OSS edition.
  </div>
);

const EnterpriseTabsLazy = React.lazy<React.ComponentType<EnterpriseTabsProps>>(async () => {
  const mod = await getEnterpriseWebModule();
  if (!mod) return { default: EnterpriseFallback };
  return { default: mod.AdminEnterpriseTabs as React.ComponentType<EnterpriseTabsProps> };
});

export function AdminOverlay(props: {
  apiBase: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  capabilities: AdminCapabilities;
}) {
  const { apiBase, open, onOpenChange, capabilities } = props;

  const showEnterprise = capabilities.hasBilling || capabilities.hasAdminEnterprise;

  const tabs = React.useMemo<TabItem[]>(() => {
    const items: TabItem[] = [];
    if (showEnterprise) items.push({ key: 'enterprise', label: 'Enterprise' });
    items.push({ key: 'maps', label: 'Maps' });
    items.push({ key: 'health', label: 'System Health' });
    items.push({ key: 'settings', label: 'Einstellungen' });
    return items;
  }, [showEnterprise]);

  const [tab, setTab] = React.useState<OssTabKey>(
    (tabs[0]?.key as OssTabKey) || 'maps',
  );

  React.useEffect(() => {
    if (!tabs.some((t) => t.key === tab)) {
      setTab((tabs[0]?.key as OssTabKey) || 'maps');
    }
  }, [tabs, tab]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Administration"
      maxWidth={1100}
      minHeight={520}
      accessories={<Tabs items={tabs} activeKey={tab} onChange={setTab as (key: string) => void} />}
    >
      {tab === 'enterprise' && (
        <React.Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
          <EnterpriseTabsLazy apiBase={apiBase} capabilities={capabilities} />
        </React.Suspense>
      )}
      {tab === 'maps' && <MapsAdmin apiBase={apiBase} />}
      {tab === 'health' && <AdminHealthDashboard onClose={() => onOpenChange(false)} />}
      {tab === 'settings' && <SettingsAdmin apiBase={apiBase} />}
    </Modal>
  );
}
