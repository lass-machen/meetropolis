import React from 'react';
import { Modal, Button } from '../system';
import { TenantsAdmin } from './TenantsAdmin';
import { BillingAdmin } from './BillingAdmin';

export function AdminOverlay(props: { apiBase: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { apiBase, open, onOpenChange } = props;
  const [tab, setTab] = React.useState<'tenants' | 'billing'>('tenants');
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Administration" maxWidth={1100}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => setTab('tenants')} variant={tab === 'tenants' ? 'primary' : 'secondary'}>Mandanten</Button>
          <Button onClick={() => setTab('billing')} variant={tab === 'billing' ? 'primary' : 'secondary'}>Pakete & Billing</Button>
        </div>
        {tab === 'tenants' ? <TenantsAdmin apiBase={apiBase} /> : <BillingAdmin apiBase={apiBase} />}
      </div>
    </Modal>
  );
}


