import React from 'react';
import { Modal, Button, Select } from '../system';

interface TenantOption {
  id: string;
  slug: string;
  name: string;
}

interface PackGrantModalProps {
  apiBase: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  packUuid: string;
  packType: 'asset' | 'avatar';
  onGranted: () => void;
}

export function PackGrantModal({ apiBase, open, onOpenChange, packUuid, packType, onGranted }: PackGrantModalProps) {
  const [tenants, setTenants] = React.useState<TenantOption[]>([]);
  const [selectedTenantId, setSelectedTenantId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [granting, setGranting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`${apiBase}/admin/tenants`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((data: TenantOption[]) => {
        setTenants(data);
        if (data.length > 0) setSelectedTenantId(data[0].id);
      })
      .catch(() => setTenants([]))
      .finally(() => setLoading(false));
  }, [apiBase, open]);

  const handleGrant = async () => {
    if (!selectedTenantId) return;
    setGranting(true);
    try {
      const res = await fetch(`${apiBase}/admin/pack-catalog/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tenantId: selectedTenantId, packType, packUuid }),
      });
      if (res.ok) {
        onGranted();
        onOpenChange(false);
      }
    } catch { /* handled by UI */ }
    setGranting(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Grant Pack Access" maxWidth={440} zIndexBase={1100}>
      <div style={{ display: 'grid', gap: 12 }}>
        {loading ? (
          <div style={{ color: 'var(--fg-subtle)' }}>Loading tenants...</div>
        ) : (
          <>
            <label style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>Select Tenant</label>
            <Select
              value={selectedTenantId}
              onChange={setSelectedTenantId}
              options={tenants.map(t => ({ value: t.id, label: `${t.name} (${t.slug})` }))}
            />
            <Button variant="primary" onClick={handleGrant} disabled={granting || !selectedTenantId}>
              {granting ? 'Granting...' : 'Grant Access'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
