import React from 'react';
import { Invoice } from '../types';
import { formatDate, formatCurrency } from '../utils';
import { styles } from '../styles';

interface InvoiceHistoryProps {
  invoices: Invoice[];
}

export function InvoiceHistory({ invoices }: InvoiceHistoryProps) {
  if (invoices.length === 0) {
    return <div style={styles.emptyState}>No invoices yet</div>;
  }

  return (
    <div style={styles.invoiceList}>
      {invoices.map((inv) => (
        <div key={inv.id} style={styles.invoiceItem}>
          <div style={styles.invoiceMain}>
            <div style={styles.invoiceNumber}>{inv.number || inv.id.slice(0, 12)}</div>
            <div style={styles.invoiceDate}>{formatDate(inv.date)}</div>
          </div>
          <div style={styles.invoiceRight}>
            <div style={styles.invoiceAmount}>{formatCurrency(inv.amount, inv.currency)}</div>
            <div style={{
              ...styles.invoiceStatus,
              color: inv.status === 'paid' ? '#22c55e' : inv.status === 'open' ? '#f59e0b' : '#6b7280'
            }}>
              {inv.status}
            </div>
          </div>
          <div style={styles.invoiceActions}>
            {inv.hostedUrl && (
              <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer" style={styles.invoiceLink}>
                View
              </a>
            )}
            {inv.pdfUrl && (
              <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" style={styles.invoiceLink}>
                PDF
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
