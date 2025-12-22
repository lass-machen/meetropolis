import React from 'react';
import { BillingStatus } from '../types';
import { styles } from '../styles';

interface UsageDisplayProps {
  status: BillingStatus;
}

export function UsageDisplay({ status }: UsageDisplayProps) {
  const usagePercent = Math.min(100, (status.usage.currentUsers / Math.max(1, status.usage.limit)) * 100);

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Usage</h3>
      <div style={styles.usageInfo}>
        <div style={styles.usageNumbers}>
          <span style={styles.usageCurrent}>{status.usage.currentUsers}</span>
          <span style={styles.usageLimit}>/ {status.usage.limit} users</span>
        </div>
        <div style={styles.usageBar}>
          <div
            style={{
              ...styles.usageFill,
              width: `${usagePercent}%`,
              background: usagePercent > 80 ? '#ef4444' : usagePercent > 50 ? '#f59e0b' : '#22c55e',
            }}
          />
        </div>
        <div style={styles.usageLabel}>
          {status.usage.freeSeats > 0 && <span>{status.usage.freeSeats} free seats</span>}
          {status.usage.paidSeats > 0 && <span> + {status.usage.paidSeats} paid seats</span>}
        </div>
      </div>
    </div>
  );
}
