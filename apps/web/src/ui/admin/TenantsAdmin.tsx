import React from 'react';
import { TableContainer, Table, THead, TBody, Tr, Th, Td, Button, Input, Select } from '../system';
import { openExternal } from '../../lib/openExternal';
import { logger } from '../../lib/logger';

type AvailablePlan = { priceId: string; name: string; amount: number; currency: string; interval: string; concurrentLimit: number };

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
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [plans, setPlans] = React.useState<AvailablePlan[]>([]);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBase}/admin/tenants`, { credentials: 'include' });
      if (res.ok) setRows(await res.json());
      const plansRes = await fetch(`${apiBase}/billing/plans`, { credentials: 'include' });
      if (plansRes.ok) { const data = await plansRes.json(); setPlans(data.plans || []); }
    } catch (err) { logger.warn('[TenantsAdmin] Failed to load tenants', err); }
    setLoading(false);
  }, [apiBase]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (!deletingId) return;
    const timer = setTimeout(() => setDeletingId(null), 3000);
    return () => clearTimeout(timer);
  }, [deletingId]);

  const deleteTenant = async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/admin/tenants/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) await load();
    } catch (err) { logger.warn('[TenantsAdmin] Failed to delete tenant', err); }
    setDeletingId(null);
  };

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
    } catch (err) { logger.warn('[TenantsAdmin] Failed to save tenant', err); }
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
    } catch (err) { logger.warn('[TenantsAdmin] Failed to create tenant', err); }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input value={createSlug} onChange={(e: any) => setCreateSlug(e.target.value)} placeholder="slug" style={{ width: 180 }} />
        <Input value={createName} onChange={(e: any) => setCreateName(e.target.value)} placeholder="name" style={{ width: 220 }} />
        <Button onClick={createTenant}>Neu anlegen</Button>
        <div style={{ flex: 1 }} />
        <Button onClick={() => load()}>{loading ? 'Lade…' : 'Neu laden'}</Button>
      </div>

      <TableContainer style={{ maxHeight: '60vh' }}>
        <Table>
          <THead>
            <Tr>
              <Th style={{ paddingLeft: 0 }}>Slug</Th>
              <Th>Name</Th>
              <Th>Online</Th>
              <Th>Limit</Th>
              <Th>Free-Limit</Th>
              <Th>Bypass</Th>
              <Th>Abo</Th>
              <Th>Status</Th>
              <Th style={{ paddingRight: 0 }}>{null}</Th>
            </Tr>
          </THead>
          {loading && (
            <TBody>
              {[1, 2, 3].map(i => (
                <Tr key={i}>
                  <Td colSpan={9} style={{ paddingLeft: 0 }}>
                    <div style={{
                      height: 16,
                      borderRadius: 4,
                      background: 'var(--glass-hover)',
                      animation: 'pulse 1.5s ease-in-out infinite',
                      width: `${60 + i * 10}%`
                    }} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          )}
          {!loading && rows.length === 0 && (
            <TBody>
              <Tr>
                <Td colSpan={9} style={{ paddingLeft: 0, textAlign: 'center', color: 'var(--fg-subtle)', padding: '32px 0' }}>
                  Keine Einträge vorhanden
                </Td>
              </Tr>
            </TBody>
          )}
          {!loading && rows.length > 0 && (
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td style={{ paddingLeft: 0 }}>{r.slug}</Td>
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
                    {plans.length > 0 ? (
                      <>
                        <Select
                          value=""
                          onChange={(val) => {
                            if (!val) return;
                            (async () => {
                              try {
                                const res = await fetch(`${apiBase}/billing/checkout-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ priceId: val }) });
                                if (res.ok) { const { url } = await res.json(); await openExternal(url); }
                              } catch (err) { logger.warn('[TenantsAdmin] Failed to start checkout', err); }
                            })();
                          }}
                          placeholder="Plan…"
                          style={{ width: 'auto' }}
                          options={plans.map(p => ({
                            value: p.priceId,
                            label: `${p.name} (${p.amount} ${p.currency}/${p.interval})`,
                          }))}
                        />
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Keine Pläne</span>
                    )}
                    <Button size="sm" onClick={async ()=>{
                      try {
                        const res = await fetch(`${apiBase}/billing/portal-session`, { method:'POST', credentials:'include' });
                        if (res.ok) { const { url } = await res.json(); await openExternal(url); }
                      } catch (err) { logger.warn('[TenantsAdmin] Failed to open portal', err); }
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
                <Td style={{ paddingRight: 0, textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="primary" onClick={() => saveRow(r)}>Speichern</Button>
                    {!r.isInternal && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => deletingId === r.id ? deleteTenant(r.id) : setDeletingId(r.id)}
                      >
                        {deletingId === r.id ? 'Wirklich löschen?' : 'Löschen'}
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
          )}
        </Table>
      </TableContainer>
    </div>
  );
}


