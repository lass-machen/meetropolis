import React from 'react';
import {
  Section,
  Button,
  Alert,
  Badge,
  DescriptionList,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  TableContainer,
} from '../system';
import type { BadgeIntent, DescriptionItem } from '../system';
import { logger } from '../../lib/logger';

interface TenantBillingPanelProps {
  apiBase: string;
  tenantId: string;
}

type BillingInvoice = {
  id?: string;
  number?: string | null;
  status?: string | null;
  amountDue?: number | null;
  amount?: number | null;
  currency?: string | null;
  created?: string | null;
  date?: string | null;
};

type BillingTenant = {
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;
  trialConvertedAt?: string | null;
  paymentFailedAt?: string | null;
  gracePeriodEndsAt?: string | null;
  dunningStep?: number | null;
  lastDunningEmailAt?: string | null;
  pausedAt?: string | null;
  pauseEndsAt?: string | null;
  pauseReason?: string | null;
  status?: string | null;
};

type BillingSubscription = {
  status?: string | null;
  plan?: string | null;
  productName?: string | null;
  interval?: string | null;
  amount?: number | null;
  currency?: string | null;
  currentPeriodEnd?: string | null;
};

type BillingCustomer = {
  id?: string | null;
  email?: string | null;
};

type BillingResponse = {
  tenant?: BillingTenant;
  stripe?: {
    customer?: BillingCustomer | null;
    subscription?: BillingSubscription | null;
    invoices?: BillingInvoice[] | null;
  };
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: BillingResponse };

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const cur = (currency || 'eur').toUpperCase();
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${cur}`;
  }
}

function badgeIntentForInvoice(status?: string | null): BadgeIntent {
  if (status === 'paid') return 'success';
  if (status === 'open' || status === 'draft') return 'warning';
  if (status === 'void' || status === 'uncollectible') return 'danger';
  return 'default';
}

export function TenantBillingPanel({ apiBase, tenantId }: TenantBillingPanelProps) {
  const [state, setState] = React.useState<LoadState>({ kind: 'loading' });

  const load = React.useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`${apiBase}/admin/tenants/${tenantId}/billing`, {
        credentials: 'include',
      });
      if (res.status === 404) {
        setState({ kind: 'unavailable' });
        return;
      }
      if (!res.ok) {
        setState({ kind: 'error', message: `HTTP ${res.status}` });
        return;
      }
      const data: BillingResponse = await res.json();
      setState({ kind: 'ready', data });
    } catch (err) {
      logger.warn('[TenantBillingPanel] Failed to load billing', err);
      setState({ kind: 'error', message: 'Verbindung fehlgeschlagen' });
    }
  }, [apiBase, tenantId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <Section
      title="Billing"
      description="Stripe-Status, Trial, Dunning und Rechnungsverlauf."
      actions={
        <Button size="sm" onClick={() => void load()}>
          Neu laden
        </Button>
      }
    >
      <BillingContent state={state} />
    </Section>
  );
}

function BillingContent({ state }: { state: LoadState }) {
  if (state.kind === 'loading') {
    return (
      <div style={{ color: 'var(--fg-subtle)', padding: '24px 0', textAlign: 'center' }}>
        Lade Billing-Details…
      </div>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <Alert intent="info">
        Enterprise Billing nicht verfügbar — dieser Bereich erfordert das @meetropolis/billing
        Submodule.
      </Alert>
    );
  }

  if (state.kind === 'error') {
    return <Alert intent="error">Fehler beim Laden: {state.message}</Alert>;
  }

  return <BillingDetails data={state.data} />;
}

function buildBillingItems(data: BillingResponse): DescriptionItem[] {
  const tenant = data.tenant ?? {};
  const sub = data.stripe?.subscription ?? {};
  const customer = data.stripe?.customer ?? {};
  const items: DescriptionItem[] = [];

  items.push({
    label: 'Plan / Status',
    value: `${sub.plan || sub.productName || '—'} — ${sub.status || '—'}`,
  });

  if (sub.amount != null) {
    items.push({
      label: 'Preis',
      value: `${formatMoney(sub.amount, sub.currency)} / ${sub.interval || 'month'}`,
    });
  }

  if (sub.currentPeriodEnd) {
    items.push({ label: 'Nächste Rechnung', value: formatDate(sub.currentPeriodEnd) });
  }

  if (customer.id) {
    items.push({
      label: 'Stripe Customer',
      value: <code style={{ fontSize: 11 }}>{customer.id}</code>,
    });
  }

  if (tenant.trialStartedAt || tenant.trialEndsAt) {
    items.push({
      label: 'Trial',
      value: `${formatDate(tenant.trialStartedAt)} → ${formatDate(tenant.trialEndsAt)}`,
    });
  }

  if (tenant.paymentFailedAt || (tenant.dunningStep ?? 0) > 0) {
    items.push({
      label: 'Dunning',
      value: `Schritt ${tenant.dunningStep || 0} — ${formatDate(tenant.paymentFailedAt)}`,
    });
  }

  if (tenant.gracePeriodEndsAt) {
    items.push({ label: 'Grace Period', value: formatDate(tenant.gracePeriodEndsAt) });
  }

  if (tenant.pausedAt) {
    const end = tenant.pauseEndsAt ? ' → ' + formatDate(tenant.pauseEndsAt) : '';
    const reason = tenant.pauseReason ? ` (${tenant.pauseReason})` : '';
    items.push({
      label: 'Pause',
      value: `${formatDate(tenant.pausedAt)}${end}${reason}`,
    });
  }

  return items;
}

function BillingDetails({ data }: { data: BillingResponse }) {
  const items = buildBillingItems(data);
  const invoices = Array.isArray(data.stripe?.invoices) ? data.stripe.invoices.slice(0, 10) : [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <DescriptionList items={items} columns={2} />
      {invoices.length > 0 && <InvoicesTable invoices={invoices} />}
      {invoices.length === 0 && items.length === 0 && (
        <div style={{ color: 'var(--fg-subtle)', padding: '24px 0', textAlign: 'center' }}>
          Keine Billing-Daten verfügbar
        </div>
      )}
    </div>
  );
}

function InvoicesTable({ invoices }: { invoices: BillingInvoice[] }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--fg)' }}>
        Rechnungen (letzte 10)
      </div>
      <TableContainer>
        <Table>
          <THead>
            <Tr>
              <Th style={{ paddingLeft: 0 }}>Datum</Th>
              <Th>Betrag</Th>
              <Th>Status</Th>
              <Th style={{ paddingRight: 0 }}>Nummer</Th>
            </Tr>
          </THead>
          <TBody>
            {invoices.map((inv, idx) => (
              <Tr key={inv.id || inv.number || idx}>
                <Td style={{ paddingLeft: 0 }}>{formatDate(inv.created || inv.date)}</Td>
                <Td>{formatMoney(inv.amountDue ?? inv.amount, inv.currency)}</Td>
                <Td>
                  <Badge intent={badgeIntentForInvoice(inv.status)}>{inv.status || '—'}</Badge>
                </Td>
                <Td style={{ paddingRight: 0 }}>
                  <code style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
                    {inv.number || inv.id || '—'}
                  </code>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  );
}
