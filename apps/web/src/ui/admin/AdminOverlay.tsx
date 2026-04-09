import React from 'react';
import { Modal, Tabs } from '../system';
import type { TabItem } from '../system';
import type { AdminCapabilities } from '../../app/routes/hooks/useFetchMe';
import { TenantsAdmin } from './TenantsAdmin';
import { BillingAdmin } from './BillingAdmin';
import { AdminHealthDashboard } from './AdminHealthDashboard';
import { PackCatalogAdmin } from './PackCatalogAdmin';
import { MapsAdmin } from './MapsAdmin';
import { AuditLogAdmin } from './AuditLogAdmin';
import { SettingsAdmin } from './SettingsAdmin';

type AdminTabKey = 'tenants' | 'billing' | 'packs' | 'maps' | 'health' | 'audit' | 'settings';

export function AdminOverlay(props: {
  apiBase: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  capabilities: AdminCapabilities;
}) {
  const { apiBase, open, onOpenChange, capabilities } = props;

  const adminTabs = React.useMemo<TabItem[]>(() => {
    const tabs: TabItem[] = [];
    tabs.push({ key: 'tenants', label: 'Mandanten' });
    if (capabilities.hasBilling) {
      tabs.push({ key: 'billing', label: 'Pakete & Billing' });
    }
    if (capabilities.hasAdminEnterprise) {
      tabs.push({ key: 'packs', label: 'Pack Catalog' });
    }
    tabs.push({ key: 'maps', label: 'Maps' });
    tabs.push({ key: 'health', label: 'System Health' });
    if (capabilities.hasBilling) {
      tabs.push({ key: 'audit', label: 'Audit Log' });
    }
    tabs.push({ key: 'settings', label: 'Einstellungen' });
    return tabs;
  }, [capabilities]);

  const [tab, setTab] = React.useState<AdminTabKey>(
    (adminTabs[0]?.key as AdminTabKey) || 'tenants',
  );

  // Fallback: wenn aktiver Tab durch Capability-Change verschwindet
  React.useEffect(() => {
    if (!adminTabs.some((t) => t.key === tab)) {
      setTab((adminTabs[0]?.key as AdminTabKey) || 'tenants');
    }
  }, [adminTabs, tab]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Administration"
      maxWidth={1100}
      minHeight={520}
      accessories={<Tabs items={adminTabs} activeKey={tab} onChange={setTab as (key: string) => void} />}
    >
      {tab === 'tenants' && <TenantsAdmin apiBase={apiBase} capabilities={capabilities} />}
      {tab === 'billing' && <BillingAdmin apiBase={apiBase} />}
      {tab === 'packs' && <PackCatalogAdmin apiBase={apiBase} />}
      {tab === 'maps' && <MapsAdmin apiBase={apiBase} />}
      {tab === 'health' && <AdminHealthDashboard onClose={() => onOpenChange(false)} />}
      {tab === 'audit' && <AuditLogAdmin apiBase={apiBase} />}
      {tab === 'settings' && <SettingsAdmin apiBase={apiBase} />}
    </Modal>
  );
}
