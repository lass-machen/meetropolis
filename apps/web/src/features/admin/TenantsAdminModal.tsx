import * as React from 'react';
import { Modal } from '../../ui/system';
import { TenantsAdmin } from '../../ui/admin/TenantsAdmin';

export function TenantsAdminModal({ open, onOpenChange, apiBase, isInternalOwner }: { open: boolean; onOpenChange: (v: boolean) => void; apiBase: string; isInternalOwner: boolean }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Mandanten-Administration" maxWidth={1000}>
      {isInternalOwner ? (
        <TenantsAdmin apiBase={apiBase} />
      ) : (
        <div style={{ color:'var(--fg-subtle)', fontSize: 13 }}>Kein Zugriff</div>
      )}
    </Modal>
  );
}


