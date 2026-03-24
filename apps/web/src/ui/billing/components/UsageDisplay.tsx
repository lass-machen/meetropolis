import { BillingStatus } from '../types';
import { Card, ProgressBar } from '../../system';

interface UsageDisplayProps {
  status: BillingStatus;
}

export function UsageDisplay({ status }: UsageDisplayProps) {
  const usagePercent = Math.min(100, (status.usage.currentUsers / Math.max(1, status.usage.limit)) * 100);

  const usageLabel = (
    <>
      {status.usage.freeSeats > 0 && <span>{status.usage.freeSeats} free seats</span>}
      {status.usage.paidSeats > 0 && <span> + {status.usage.paidSeats} paid seats</span>}
    </>
  );

  return (
    <Card title="Usage" style={{ marginBottom: 16 }}>
      <div>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 32, fontWeight: 700, color: 'var(--fg, #fff)' }}>
            {status.usage.currentUsers}
          </span>
          <span style={{ fontSize: 16, color: 'var(--fg-subtle, #888)', marginLeft: 4 }}>
            / {status.usage.limit} users
          </span>
        </div>
        <ProgressBar
          value={usagePercent}
          intent={usagePercent > 80 ? 'danger' : usagePercent > 50 ? 'warning' : 'success'}
          label={usageLabel}
        />
      </div>
    </Card>
  );
}
