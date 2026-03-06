import React from 'react';
import { Modal, Button } from '../system';
import { TenantsAdmin } from './TenantsAdmin';
import { BillingAdmin } from './BillingAdmin';
import { AdminHealthDashboard } from './AdminHealthDashboard';
import { PackCatalogAdmin } from './PackCatalogAdmin';
import { SettingsAdmin } from './SettingsAdmin';

export function AdminOverlay(props: { apiBase: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { apiBase, open, onOpenChange } = props;
  const [tab, setTab] = React.useState<'tenants' | 'billing' | 'health' | 'packs' | 'settings'>('tenants');
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Administration" maxWidth={1100}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => setTab('tenants')} variant={tab === 'tenants' ? 'primary' : 'secondary'}>Mandanten</Button>
          <Button onClick={() => setTab('billing')} variant={tab === 'billing' ? 'primary' : 'secondary'}>Pakete & Billing</Button>
          <Button onClick={() => setTab('health')} variant={tab === 'health' ? 'primary' : 'secondary'}>System Health</Button>
          <Button onClick={() => setTab('packs')} variant={tab === 'packs' ? 'primary' : 'secondary'}>Pack Catalog</Button>
          <Button onClick={() => setTab('settings')} variant={tab === 'settings' ? 'primary' : 'secondary'}>Einstellungen</Button>
        </div>
        {tab === 'tenants' && <TenantsAdmin apiBase={apiBase} />}
        {tab === 'billing' && <BillingAdmin apiBase={apiBase} />}
        {tab === 'health' && <AdminHealthDashboard onClose={() => onOpenChange(false)} />}
        {tab === 'packs' && <PackCatalogAdmin apiBase={apiBase} />}
        {tab === 'settings' && <SettingsAdmin apiBase={apiBase} />}
      </div>
    </Modal>
  );
}


