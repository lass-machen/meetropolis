import React from 'react';
import { TableContainer, Table, THead, TBody, Tr, Th, Td, Button, Input, Card } from '../system';

type PriceRow = {
  id: string;
  unitAmount: number | null;
  currency: string;
  active: boolean;
  recurring?: { interval: 'day' | 'week' | 'month' | 'year' } | null;
  metadata?: Record<string, string>;
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  metadata?: Record<string, string>;
  prices: PriceRow[];
};

export function BillingAdmin(props: { apiBase: string }) {
  const { apiBase } = props;
  const [rows, setRows] = React.useState<ProductRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [metrics, setMetrics] = React.useState<{ activeSubscriptions: number; mrrCents: number; revenue30dCents: number } | null>(null);

  const [newName, setNewName] = React.useState('');
  const [newDesc, setNewDesc] = React.useState('');
  const [newAmount, setNewAmount] = React.useState<number>(0);
  const [newCurrency, setNewCurrency] = React.useState('eur');
  const [newInterval, setNewInterval] = React.useState<'month' | 'year'>('month');
  const [newConcurrent, setNewConcurrent] = React.useState<number>(10);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, mRes] = await Promise.all([
        fetch(`${apiBase}/admin/billing/products`, { credentials: 'include' }),
        fetch(`${apiBase}/admin/billing/metrics`, { credentials: 'include' })
      ]);
      if (prodRes.ok) setRows(await prodRes.json());
      if (mRes.ok) setMetrics(await mRes.json());
    } catch {}
    setLoading(false);
  }, [apiBase]);

  React.useEffect(() => { void load(); }, [load]);

  const createProduct = async () => {
    if (!newName || !newAmount || !newConcurrent) return;
    try {
      const res = await fetch(`${apiBase}/admin/billing/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newName, description: newDesc || undefined, amount: newAmount, currency: newCurrency, interval: newInterval, concurrentLimit: newConcurrent })
      });
      if (res.ok) {
        setNewName(''); setNewDesc(''); setNewAmount(0); setNewCurrency('eur'); setNewInterval('month'); setNewConcurrent(10);
        await load();
      }
    } catch {}
  };

  const addPrice = async (productId: string) => {
    const amount = Number(prompt('Betrag (in Cent)?', '0') || '0');
    const concurrent = Number(prompt('Concurrent-Limit?', '10') || '10');
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(concurrent) || concurrent <= 0) return;
    try {
      const res = await fetch(`${apiBase}/admin/billing/products/${productId}/prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount, currency: 'eur', interval: 'month', concurrentLimit: concurrent })
      });
      if (res.ok) await load();
    } catch {}
  };

  const toggleProduct = async (productId: string, active: boolean) => {
    try {
      const res = await fetch(`${apiBase}/admin/billing/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ active })
      });
      if (res.ok) await load();
    } catch {}
  };

  const togglePrice = async (priceId: string, active: boolean) => {
    try {
      const res = await fetch(`${apiBase}/admin/billing/prices/${priceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ active })
      });
      if (res.ok) await load();
    } catch {}
  };

  const fmtEur = (cents?: number | null) => typeof cents === 'number' ? (cents / 100).toFixed(2) + ' €' : '-';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card style={{ padding: 12 }}>
        <div style={{ display:'flex', gap: 16, alignItems:'center', flexWrap:'wrap' }}>
          <div><b>Aktive Subscriptions:</b> {metrics?.activeSubscriptions ?? '-'}</div>
          <div><b>MRR:</b> {fmtEur(metrics?.mrrCents ?? null)}</div>
          <div><b>Umsatz 30T:</b> {fmtEur(metrics?.revenue30dCents ?? null)}</div>
          <div style={{ flex: 1 }} />
          <Button onClick={() => load()}>{loading ? 'Lade…' : 'Neu laden'}</Button>
        </div>
      </Card>

      <Card style={{ padding: 12 }}>
        <div style={{ display:'flex', gap: 8, alignItems:'center', flexWrap:'wrap' }}>
          <Input placeholder="Produktname" value={newName} onChange={(e: any)=>setNewName(e.target.value)} style={{ width: 200 }} />
          <Input placeholder="Beschreibung" value={newDesc} onChange={(e: any)=>setNewDesc(e.target.value)} style={{ width: 260 }} />
          <Input type="number" placeholder="Betrag (Cent)" value={newAmount} onChange={(e: any)=>setNewAmount(Number(e.target.value)||0)} style={{ width: 140 }} />
          <Input placeholder="Währung" value={newCurrency} onChange={(e: any)=>setNewCurrency(e.target.value)} style={{ width: 90 }} />
          <select value={newInterval} onChange={(e)=>setNewInterval((e.target.value as any))}>
            <option value="month">monatlich</option>
            <option value="year">jährlich</option>
          </select>
          <Input type="number" placeholder="Concurrent-Limit" value={newConcurrent} onChange={(e: any)=>setNewConcurrent(Number(e.target.value)||0)} style={{ width: 140 }} />
          <Button onClick={createProduct}>Paket anlegen</Button>
        </div>
      </Card>

      <TableContainer style={{ maxHeight: '60vh' }}>
        <Table>
          <THead>
            <Tr>
              <Th>Produkt</Th>
              <Th>Aktiv</Th>
              <Th>Preise</Th>
              <Th>Aktionen</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map(p => (
              <Tr key={p.id}>
                <Td>
                  <div style={{ display:'grid', gap: 4 }}>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ color:'var(--muted)' }}>{p.description || ''}</div>
                  </div>
                </Td>
                <Td>
                  <input type="checkbox" checked={p.active} onChange={(e)=>toggleProduct(p.id, e.target.checked)} />
                </Td>
                <Td>
                  <div style={{ display:'grid', gap: 6 }}>
                    {p.prices.map(pr => (
                      <div key={pr.id} style={{ display:'flex', alignItems:'center', gap: 8 }}>
                        <code style={{ background:'var(--glass)', padding:'2px 6px', borderRadius:6 }}>{fmtEur(pr.unitAmount)} {pr.recurring?.interval || ''}</code>
                        <span style={{ color:'var(--muted)' }}>limit {(pr.metadata?.concurrent_limit) || '-'}</span>
                        <label style={{ display:'inline-flex', alignItems:'center', gap: 6 }}>
                          <input type="checkbox" checked={pr.active} onChange={(e)=>togglePrice(pr.id, e.target.checked)} /> aktiv
                        </label>
                      </div>
                    ))}
                  </div>
                </Td>
                <Td>
                  <Button onClick={()=>addPrice(p.id)}>Preis hinzufügen</Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  );
}


