import * as React from 'react';
import { Modal, Button, Card, Tr, Td } from '../../ui/system';
import { AdminTable } from '../../ui/admin/AdminTable';

type Invite = { code: string; email?: string | null; usedAt?: string | null; createdAt?: string };

export function InvitesModal({ open, onOpenChange, apiBase }: { open: boolean; onOpenChange: (v: boolean) => void; apiBase: string }) {
  const [invites, setInvites] = React.useState<Invite[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${apiBase}/invites`, { credentials: 'include' });
        if (res.ok) setInvites(await res.json());
      } catch {}
      setLoading(false);
    })();
  }, [open, apiBase]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Einladungen" maxWidth={900}>
      {loading ? (
        <div style={{ color:'var(--fg-subtle)', fontSize: 13 }}>Lade Einladungen…</div>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <AdminTable
            headers={[ 'Code', 'E-Mail', 'Erstellt', 'Status', <span key="actions" style={{ display:'inline-block', width: 220 }}>Aktionen</span> ]}
          >
            {invites.length === 0 && (
              <tr><td colSpan={5} style={{ padding:'12px', color:'var(--fg-subtle)' }}>Keine Einladungen vorhanden.</td></tr>
            )}
            {invites.map(inv => (
              <Tr key={inv.code} style={{ borderBottom: '1px solid var(--border)' }}>
                <Td>
                  <code style={{ display:'inline-block', padding:'4px 6px', borderRadius:6, border:'1px solid var(--border)', background:'rgba(255,255,255,0.06)' }}>{inv.code}</code>
                </Td>
                <Td>{inv.email || '—'}</Td>
                <Td>{inv.createdAt ? new Date(inv.createdAt).toLocaleString() : '—'}</Td>
                <Td>{inv.usedAt ? 'Eingelöst' : 'Offen'}</Td>
                <Td style={{ display:'flex', gap: 8 }}>
                  <Button onClick={async ()=>{ try { await navigator.clipboard.writeText(inv.code); } catch {} }} style={{ padding:'6px 16px', borderRadius: 6, fontSize: 13 }}>Kopieren</Button>
                  {!inv.usedAt && (
                    <Button variant="danger" onClick={async ()=>{
                      try {
                        const res = await fetch(`${apiBase}/invites/${encodeURIComponent(inv.code)}`, { method:'DELETE', credentials:'include' });
                        if (res.ok) setInvites(prev => prev.filter(i => i.code !== inv.code));
                      } catch {}
                    }} style={{ padding:'6px 16px', borderRadius: 6, fontSize: 13 }}>Löschen</Button>
                  )}
                </Td>
              </Tr>
            ))}
          </AdminTable>
        </Card>
      )}
    </Modal>
  );
}


