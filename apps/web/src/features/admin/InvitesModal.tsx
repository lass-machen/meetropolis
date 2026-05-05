import * as React from 'react';
import { Modal, Button, Card, Table, THead, TBody, Tr, Th, Td, TableContainer } from '../../ui/system';

type Invite = { code: string; email?: string | null; usedAt?: string | null; createdAt?: string };

function InvitesTableHeader() {
  return (
    <THead sticky>
      <Tr>
        <Th style={{ paddingLeft: 0 }}>Code</Th>
        <Th>E-Mail</Th>
        <Th>Erstellt</Th>
        <Th>Status</Th>
        <Th style={{ paddingRight: 0 }}>{null}</Th>
      </Tr>
    </THead>
  );
}

function InvitesLoadingRows() {
  return (
    <TBody>
      {[1, 2, 3].map(i => (
        <Tr key={i}>
          <Td colSpan={5} style={{ paddingLeft: 0 }}>
            <div style={{ height: 16, borderRadius: 4, background: 'var(--glass-hover)', animation: 'pulse 1.5s ease-in-out infinite', width: `${60 + i * 10}%` }} />
          </Td>
        </Tr>
      ))}
    </TBody>
  );
}

function InvitesEmptyRow() {
  return (
    <TBody>
      <Tr>
        <Td colSpan={5} style={{ paddingLeft: 0, textAlign: 'center', color: 'var(--fg-subtle)', padding: '32px 0' }}>
          Keine Einladungen vorhanden.
        </Td>
      </Tr>
    </TBody>
  );
}

function InviteRow({ inv, onDelete }: { inv: Invite; onDelete: (code: string) => void | Promise<void> }) {
  return (
    <Tr style={{ borderBottom: '1px solid var(--border)' }}>
      <Td style={{ paddingLeft: 0 }}>
        <code style={{ display:'inline-block', padding:'4px 6px', borderRadius:6, border:'1px solid var(--border)', background:'rgba(255,255,255,0.06)' }}>{inv.code}</code>
      </Td>
      <Td>{inv.email || '—'}</Td>
      <Td>{inv.createdAt ? new Date(inv.createdAt).toLocaleString() : '—'}</Td>
      <Td>{inv.usedAt ? 'Eingelöst' : 'Offen'}</Td>
      <Td style={{ paddingRight: 0, textAlign: 'right', display:'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button size="sm" onClick={async ()=>{ try { await navigator.clipboard.writeText(inv.code); } catch {} }}>Kopieren</Button>
        {!inv.usedAt && (
          <Button size="sm" variant="danger" onClick={() => onDelete(inv.code)}>Löschen</Button>
        )}
      </Td>
    </Tr>
  );
}

function useInvites(open: boolean, apiBase: string) {
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

  const deleteInvite = async (code: string) => {
    try {
      const res = await fetch(`${apiBase}/invites/${encodeURIComponent(code)}`, { method:'DELETE', credentials:'include' });
      if (res.ok) setInvites(prev => prev.filter(i => i.code !== code));
    } catch {}
  };

  return { invites, loading, deleteInvite };
}

export function InvitesModal({ open, onOpenChange, apiBase }: { open: boolean; onOpenChange: (v: boolean) => void; apiBase: string }) {
  const { invites, loading, deleteInvite } = useInvites(open, apiBase);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Einladungen" maxWidth={900}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <TableContainer maxHeight="60vh">
          <Table>
            <InvitesTableHeader />
            {loading && <InvitesLoadingRows />}
            {!loading && invites.length === 0 && <InvitesEmptyRow />}
            {!loading && invites.length > 0 && (
              <TBody>
                {invites.map(inv => (
                  <InviteRow key={inv.code} inv={inv} onDelete={deleteInvite} />
                ))}
              </TBody>
            )}
          </Table>
        </TableContainer>
      </Card>
    </Modal>
  );
}


