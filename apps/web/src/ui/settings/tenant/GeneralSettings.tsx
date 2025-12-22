import React from 'react';
import type { TenantInfo } from './types';

interface GeneralSettingsProps {
  tenant: TenantInfo;
  onNavigateToMembers: () => void;
}

export function GeneralSettings({ tenant, onNavigateToMembers }: GeneralSettingsProps) {
  return (
    <>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Organization Info</h3>

        <div style={styles.infoGrid}>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>Subdomain</span>
            <span style={styles.infoValue}>{tenant.slug}</span>
          </div>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>Name</span>
            <span style={styles.infoValue}>{tenant.name}</span>
          </div>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>Seat Limit</span>
            <span style={styles.infoValue}>
              {tenant.bypassLimits ? 'Unlimited' : `${tenant.freeSeats + tenant.concurrentLimit} users`}
            </span>
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Quick Actions</h3>
        <div style={styles.actionButtons}>
          <button onClick={onNavigateToMembers} style={styles.secondaryBtn}>
            Manage Members
          </button>
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--fg-subtle, #888)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  infoGrid: {
    display: 'grid',
    gap: 12,
  },
  infoItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
  },
  infoLabel: {
    color: 'var(--fg-subtle, #888)',
    fontSize: 14,
  },
  infoValue: {
    color: 'var(--fg, #fff)',
    fontSize: 14,
    fontWeight: 500,
  },
  actionButtons: {
    display: 'flex',
    gap: 12,
  },
  secondaryBtn: {
    padding: '10px 20px',
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid var(--border, rgba(255,255,255,0.2))',
    borderRadius: 8,
    color: 'var(--fg, #fff)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
};
