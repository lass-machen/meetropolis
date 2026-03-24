import { useTranslation } from 'react-i18next';
import { Invoice } from '../types';
import { formatDate, formatCurrency } from '../utils';
import { Card, Badge } from '../../system';

interface InvoiceHistoryProps {
  invoices: Invoice[];
}

export function InvoiceHistory({ invoices }: InvoiceHistoryProps) {
  const { t } = useTranslation();

  if (invoices.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-subtle, #888)' }}>
        {t('billing.noInvoices')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {invoices.map((inv) => (
        <Card key={inv.id} style={{ padding: 12, marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: 'var(--fg, #fff)', fontSize: 14 }}>
                {inv.number || inv.id.slice(0, 12)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-subtle, #888)' }}>
                {formatDate(inv.date)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600, color: 'var(--fg, #fff)' }}>
                {formatCurrency(inv.amount, inv.currency)}
              </div>
              <Badge
                intent={inv.status === 'paid' ? 'success' : inv.status === 'open' ? 'warning' : 'default'}
              >
                {inv.status}
              </Badge>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {inv.hostedUrl && (
                <a
                  href={inv.hostedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent, #3b82f6)', textDecoration: 'none', fontSize: 13 }}
                >
                  {t('billing.view')}
                </a>
              )}
              {inv.pdfUrl && (
                <a
                  href={inv.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent, #3b82f6)', textDecoration: 'none', fontSize: 13 }}
                >
                  {t('billing.pdf')}
                </a>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
