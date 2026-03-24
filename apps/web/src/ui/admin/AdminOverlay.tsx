import React from 'react';
import { Modal, Tabs } from '../system';
import type { TabItem } from '../system';
import { TenantsAdmin } from './TenantsAdmin';
import { BillingAdmin } from './BillingAdmin';
import { AdminHealthDashboard } from './AdminHealthDashboard';
import { PackCatalogAdmin } from './PackCatalogAdmin';
import { SettingsAdmin } from './SettingsAdmin';

const adminTabs: TabItem[] = [
  { key: 'tenants', label: 'Mandanten' },
  { key: 'billing', label: 'Pakete & Billing' },
  { key: 'health', label: 'System Health' },
  { key: 'packs', label: 'Pack Catalog' },
  { key: 'settings', label: 'Einstellungen' },
];

export function AdminOverlay(props: { apiBase: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { apiBase, open, onOpenChange } = props;
  const [tab, setTab] = React.useState<'tenants' | 'billing' | 'health' | 'packs' | 'settings'>('tenants');
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Administration"
      maxWidth={1100}
      minHeight={520}
      accessories={<Tabs items={adminTabs} activeKey={tab} onChange={setTab as (key: string) => void} />}
    >
      {tab === 'tenants' && <TenantsAdmin apiBase={apiBase} />}
      {tab === 'billing' && <BillingAdmin apiBase={apiBase} />}
      {tab === 'health' && <AdminHealthDashboard onClose={() => onOpenChange(false)} />}
      {tab === 'packs' && <PackCatalogAdmin apiBase={apiBase} />}
      {tab === 'settings' && <SettingsAdmin apiBase={apiBase} />}
    </Modal>
  );
}


