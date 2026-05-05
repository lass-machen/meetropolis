import React from 'react';
import { TableContainer, Table, THead, TBody, Tr, Th, Td, Button, Input, Card, Select } from '../system';
import { logger } from '../../lib/logger';

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

const fmtEur = (cents?: number | null) => typeof cents === 'number' ? (cents / 100).toFixed(2) + ' €' : '-';

function useBillingAdminData(apiBase: string) {
  const [rows, setRows] = React.useState<ProductRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [metrics, setMetrics] = React.useState<{ activeSubscriptions: number; mrrCents: number; revenue30dCents: number } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, mRes] = await Promise.all([
        fetch(`${apiBase}/admin/billing/products`, { credentials: 'include' }),
        fetch(`${apiBase}/admin/billing/metrics`, { credentials: 'include' })
      ]);
      if (prodRes.ok) setRows(await prodRes.json());
      if (mRes.ok) setMetrics(await mRes.json());
    } catch (err) { logger.warn('[BillingAdmin] Failed to load data', err); }
    setLoading(false);
  }, [apiBase]);

  React.useEffect(() => { void load(); }, [load]);

  const toggleProduct = async (productId: string, active: boolean) => {
    try {
      const res = await fetch(`${apiBase}/admin/billing/products/${productId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ active }) });
      if (res.ok) await load();
    } catch (err) { logger.warn('[BillingAdmin] Failed to toggle product', err); }
  };
  const togglePrice = async (priceId: string, active: boolean) => {
    try {
      const res = await fetch(`${apiBase}/admin/billing/prices/${priceId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ active }) });
      if (res.ok) await load();
    } catch (err) { logger.warn('[BillingAdmin] Failed to toggle price', err); }
  };

  return { rows, loading, metrics, load, toggleProduct, togglePrice };
}

function CreateProductForm({ apiBase, onCreated }: { apiBase: string; onCreated: () => void | Promise<void> }) {
  const [newName, setNewName] = React.useState('');
  const [newDesc, setNewDesc] = React.useState('');
  const [newAmount, setNewAmount] = React.useState<number>(0);
  const [newCurrency, setNewCurrency] = React.useState('eur');
  const [newInterval, setNewInterval] = React.useState<'month' | 'year'>('month');
  const [newConcurrent, setNewConcurrent] = React.useState<number>(10);

  const createProduct = async () => {
    if (!newName || !newAmount || !newConcurrent) return;
    try {
      const res = await fetch(`${apiBase}/admin/billing/products`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ name: newName, description: newDesc || undefined, amount: newAmount, currency: newCurrency, interval: newInterval, concurrentLimit: newConcurrent })
      });
      if (res.ok) {
        setNewName(''); setNewDesc(''); setNewAmount(0); setNewCurrency('eur'); setNewInterval('month'); setNewConcurrent(10);
        await onCreated();
      }
    } catch (err) { logger.warn('[BillingAdmin] Failed to create product', err); }
  };

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display:'flex', gap: 8, alignItems:'center', flexWrap:'wrap' }}>
        <Input placeholder="Produktname" value={newName} onChange={(e: any)=>setNewName(e.target.value)} style={{ width: 200 }} />
        <Input placeholder="Beschreibung" value={newDesc} onChange={(e: any)=>setNewDesc(e.target.value)} style={{ width: 260 }} />
        <Input type="number" placeholder="Betrag (Cent)" value={newAmount} onChange={(e: any)=>setNewAmount(Number(e.target.value)||0)} style={{ width: 140 }} />
        <Input placeholder="Währung" value={newCurrency} onChange={(e: any)=>setNewCurrency(e.target.value)} style={{ width: 90 }} />
        <Select value={newInterval} onChange={(val) => setNewInterval(val as any)} options={[{ value: 'month', label: 'monatlich' }, { value: 'year', label: 'jährlich' }]} />
        <Input type="number" placeholder="Concurrent-Limit" value={newConcurrent} onChange={(e: any)=>setNewConcurrent(Number(e.target.value)||0)} style={{ width: 140 }} />
        <Button onClick={createProduct}>Paket anlegen</Button>
      </div>
    </Card>
  );
}

function PriceEditor({ apiBase, productId, onSaved, onCancel }: { apiBase: string; productId: string; onSaved: () => void | Promise<void>; onCancel: () => void }) {
  const [amount, setAmount] = React.useState<number>(0);
  const [concurrent, setConcurrent] = React.useState<number>(10);
  const submit = async () => {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(concurrent) || concurrent <= 0) return;
    try {
      const res = await fetch(`${apiBase}/admin/billing/products/${productId}/prices`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ amount, currency: 'eur', interval: 'month', concurrentLimit: concurrent })
      });
      if (res.ok) await onSaved();
    } catch (err) { logger.warn('[BillingAdmin] Failed to add price', err); }
  };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <Input type="number" placeholder="Betrag (Cent)" value={amount} onChange={(e: any) => setAmount(Number(e.target.value) || 0)} style={{ width: 120 }} />
      <Input type="number" placeholder="Limit" value={concurrent} onChange={(e: any) => setConcurrent(Number(e.target.value) || 0)} style={{ width: 80 }} />
      <Button size="sm" onClick={submit}>OK</Button>
      <Button size="sm" onClick={onCancel}>&#x2715;</Button>
    </div>
  );
}

function PriceList({ prices, togglePrice }: { prices: PriceRow[]; togglePrice: (id: string, a: boolean) => void }) {
  return (
    <div style={{ display:'grid', gap: 6 }}>
      {prices.map(pr => (
        <div key={pr.id} style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <code style={{ background:'var(--glass)', padding:'2px 6px', borderRadius:6 }}>{fmtEur(pr.unitAmount)} {pr.recurring?.interval || ''}</code>
          <span style={{ color:'var(--muted)' }}>limit {(pr.metadata?.concurrent_limit) || '-'}</span>
          <label style={{ display:'inline-flex', alignItems:'center', gap: 6 }}>
            <input type="checkbox" checked={pr.active} onChange={(e)=>togglePrice(pr.id, e.target.checked)} /> aktiv
          </label>
        </div>
      ))}
    </div>
  );
}

function ProductRowComp({ p, apiBase, addPriceTarget, setAddPriceTarget, toggleProduct, togglePrice, reload }: { p: ProductRow; apiBase: string; addPriceTarget: string | null; setAddPriceTarget: (s: string | null) => void; toggleProduct: (id: string, a: boolean) => void; togglePrice: (id: string, a: boolean) => void; reload: () => void | Promise<void> }) {
  return (
    <Tr>
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
        <PriceList prices={p.prices} togglePrice={togglePrice} />
      </Td>
      <Td>
        {addPriceTarget === p.id ? (
          <PriceEditor apiBase={apiBase} productId={p.id} onSaved={async () => { setAddPriceTarget(null); await reload(); }} onCancel={() => setAddPriceTarget(null)} />
        ) : (
          <Button size="sm" onClick={() => setAddPriceTarget(p.id)}>Preis hinzufügen</Button>
        )}
      </Td>
    </Tr>
  );
}

function MetricsBar({ metrics, loading, onReload }: { metrics: { activeSubscriptions: number; mrrCents: number; revenue30dCents: number } | null; loading: boolean; onReload: () => void }) {
  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display:'flex', gap: 16, alignItems:'center', flexWrap:'wrap' }}>
        <div><b>Aktive Subscriptions:</b> {metrics?.activeSubscriptions ?? '-'}</div>
        <div><b>MRR:</b> {fmtEur(metrics?.mrrCents ?? null)}</div>
        <div><b>Umsatz 30T:</b> {fmtEur(metrics?.revenue30dCents ?? null)}</div>
        <div style={{ flex: 1 }} />
        <Button onClick={onReload}>{loading ? 'Lade…' : 'Neu laden'}</Button>
      </div>
    </Card>
  );
}

function ProductsTable({ rows, loading, addPriceTarget, setAddPriceTarget, toggleProduct, togglePrice, apiBase, reload }: { rows: ProductRow[]; loading: boolean; addPriceTarget: string | null; setAddPriceTarget: (s: string | null) => void; toggleProduct: (id: string, a: boolean) => void; togglePrice: (id: string, a: boolean) => void; apiBase: string; reload: () => void | Promise<void> }) {
  return (
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
        {loading && (
          <TBody>
            {[1, 2, 3].map(i => (
              <Tr key={i}>
                <Td colSpan={4} style={{ paddingLeft: 0 }}>
                  <div style={{ height: 16, borderRadius: 4, background: 'var(--glass-hover)', animation: 'pulse 1.5s ease-in-out infinite', width: `${60 + i * 10}%` }} />
                </Td>
              </Tr>
            ))}
          </TBody>
        )}
        {!loading && rows.length === 0 && (
          <TBody>
            <Tr>
              <Td colSpan={4} style={{ paddingLeft: 0, textAlign: 'center', color: 'var(--fg-subtle)', padding: '32px 0' }}>
                Keine Einträge vorhanden
              </Td>
            </Tr>
          </TBody>
        )}
        {!loading && rows.length > 0 && (
          <TBody>
            {rows.map(p => (
              <ProductRowComp
                key={p.id}
                p={p}
                apiBase={apiBase}
                addPriceTarget={addPriceTarget}
                setAddPriceTarget={setAddPriceTarget}
                toggleProduct={toggleProduct}
                togglePrice={togglePrice}
                reload={reload}
              />
            ))}
          </TBody>
        )}
      </Table>
    </TableContainer>
  );
}

export function BillingAdmin(props: { apiBase: string }) {
  const { apiBase } = props;
  const { rows, loading, metrics, load, toggleProduct, togglePrice } = useBillingAdminData(apiBase);
  const [addPriceTarget, setAddPriceTarget] = React.useState<string | null>(null);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <MetricsBar metrics={metrics} loading={loading} onReload={() => load()} />
      <CreateProductForm apiBase={apiBase} onCreated={load} />
      <ProductsTable
        rows={rows}
        loading={loading}
        addPriceTarget={addPriceTarget}
        setAddPriceTarget={setAddPriceTarget}
        toggleProduct={toggleProduct}
        togglePrice={togglePrice}
        apiBase={apiBase}
        reload={load}
      />
    </div>
  );
}
