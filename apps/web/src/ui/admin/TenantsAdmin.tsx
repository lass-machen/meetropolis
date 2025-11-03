import React from 'react';
import { AdminTable } from './AdminTable';
import { TableContainer, Table, THead, TBody, Tr, Th, Td, Button, Input } from '../system';

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  concurrentLimit: number;
  freeSeats?: number;
  bypassLimits: boolean;
  isInternal: boolean;
  status: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  createdAt: string;
  updatedAt: string;
  online: number;
};

export function TenantsAdmin(props: { apiBase: string }) {
  const { apiBase } = props;
  const [rows, setRows] = React.useState<TenantRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [createSlug, setCreateSlug] = React.useState('');
  const [createName, setCreateName] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBase}/admin/tenants`, { credentials: 'include' });
      if (res.ok) setRows(await res.json());
    } catch {}
    setLoading(false);
  }, [apiBase]);

  React.useEffect(() => { void load(); }, [load]);

  const updateRow = (id: string, patch: Partial<TenantRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } as TenantRow : r)));
  };

  const saveRow = async (r: TenantRow) => {
    try {
      const res = await fetch(`${apiBase}/admin/tenants/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: r.name, concurrentLimit: r.concurrentLimit, freeSeats: r.freeSeats ?? 0, bypassLimits: r.bypassLimits, status: r.status ?? undefined }),
      });
      if (res.ok) await load();
    } catch {}
  };

  const createTenant = async () => {
    const slug = (createSlug || '').trim().toLowerCase();
    const name = (createName || '').trim();
    if (!slug || !name) return;
    try {
      const res = await fetch(`${apiBase}/admin/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ slug, name, freeSeats: 3 }),
      });
      if (res.ok) {
        setCreateSlug('');
        setCreateName('');
        await load();
      }
    } catch {}
  };

  const ensureLassmachen = async () => {
    try {
      const exists = rows.some((r) => r.slug === 'lassmachen');
      if (exists) return;
      const res = await fetch(`${apiBase}/admin/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ slug: 'lassmachen', name: 'lassmachen', concurrentLimit: 999999, freeSeats: 3, bypassLimits: true }),
      });
      if (res.ok) await load();
    } catch {}
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input value={createSlug} onChange={(e: any) => setCreateSlug(e.target.value)} placeholder="slug" style={{ width: 180 }} />
        <Input value={createName} onChange={(e: any) => setCreateName(e.target.value)} placeholder="name" style={{ width: 220 }} />
        <Button onClick={createTenant}>Neu anlegen</Button>
        <div style={{ flex: 1 }} />
        <Button onClick={ensureLassmachen}>Mandant "lassmachen" sicherstellen</Button>
        <Button onClick={() => load()}>{loading ? 'Lade…' : 'Neu laden'}</Button>
      </div>

      <TableContainer style={{ maxHeight: '60vh' }}>
        <Table>
          <THead>
            <Tr>
              <Th>Slug</Th>
              <Th>Name</Th>
              <Th>Online</Th>
              <Th>Limit</Th>
              <Th>Free-Limit</Th>
              <Th>Bypass</Th>
              <Th>Abo</Th>
              <Th>Status</Th>
              <Th>Aktionen</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>{r.slug}</Td>
                <Td>
                  <Input value={r.name} onChange={(e: any) => updateRow(r.id, { name: e.target.value })} />
                </Td>
                <Td>{r.online}</Td>
                <Td>
                  <Input type="number" value={r.concurrentLimit} onChange={(e: any) => updateRow(r.id, { concurrentLimit: Number(e.target.value) || 0 })} style={{ width: 100 }} />
                </Td>
                <Td>
                  <Input type="number" value={r.freeSeats ?? 0} onChange={(e: any) => updateRow(r.id, { freeSeats: Number(e.target.value) || 0 })} style={{ width: 100 }} />
                </Td>
                <Td>
                  <input type="checkbox" checked={r.bypassLimits} onChange={(e) => updateRow(r.id, { bypassLimits: e.target.checked })} />
                </Td>
                <Td>
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <Button onClick={async ()=>{
                      try {
                        const res = await fetch(`${apiBase}/billing/checkout-session`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ plan: 'BASIC' }) });
                        if (res.ok) { const { url } = await res.json(); window.open(url, '_blank'); }
                      } catch {}
                    }}>Checkout</Button>
                    <Button onClick={async ()=>{
                      try {
                        const res = await fetch(`${apiBase}/billing/portal-session`, { method:'POST', credentials:'include' });
                        if (res.ok) { const { url } = await res.json(); window.open(url, '_blank'); }
                      } catch {}
                    }}>Portal</Button>
                  </div>
                  {r.stripeCustomerId ? (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--fg-subtle)' }}>
                      Cust: <code>{(r.stripeCustomerId || '').slice(0,10)}…</code>{' '}
                      {r.stripeSubscriptionId ? <>Sub: <code>{(r.stripeSubscriptionId || '').slice(0,10)}…</code></> : null}
                    </div>
                  ) : null}
                </Td>
                <Td>
                  <Input value={r.status || ''} onChange={(e: any) => updateRow(r.id, { status: e.target.value || null })} />
                </Td>
                <Td>
                  <Button onClick={() => saveRow(r)}>Speichern</Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  );
}


