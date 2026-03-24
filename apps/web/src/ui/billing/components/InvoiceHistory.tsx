import { useTranslation } from 'react-i18next';
import { Invoice } from '../types';
import { formatDate, formatCurrency } from '../utils';
import { Card, Badge, Button } from '../../system';

interface InvoiceHistoryProps {
  invoices: Invoice[];
}

function statusIntent(status: string) {
  if (status === 'paid') return 'success' as const;
  if (status === 'open') return 'warning' as const;
  return 'default' as const;
}

function statusLabel(status: string, t: (key: string) => string) {
  if (status === 'paid') return t('billing.statusPaid');
  if (status === 'open') return t('billing.statusOpen');
  if (status === 'failed') return t('billing.statusFailed');
  return status;
}

export function InvoiceHistory({ invoices }: InvoiceHistoryProps) {
  const { t } = useTranslation();

  if (invoices.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-subtle)' }}>
        {t('billing.noInvoices')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {invoices.map((inv) => (
        <Card key={inv.id} style={{ padding: 12, marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Invoice number + date */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 14 }}>
                {inv.number || inv.id.slice(0, 12)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 2 }}>
                {inv.date ? formatDate(inv.date) : '—'}
              </div>
            </div>

            {/* Amount + Status badge side by side */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 14 }}>
                {formatCurrency(inv.amount, inv.currency)}
              </span>
              <Badge intent={statusIntent(inv.status ?? '')}>
                {statusLabel(inv.status ?? '', t)}
              </Badge>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {inv.hostedUrl && (
                <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  <Button size="sm" variant="secondary">{t('billing.view')}</Button>
                </a>
              )}
              {inv.pdfUrl && (
                <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  <Button size="sm" variant="secondary">{t('billing.pdf')}</Button>
                </a>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
