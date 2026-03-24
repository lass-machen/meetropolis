import type { TenantInfo } from './types';
import { Section, Button } from '../../system';

interface GeneralSettingsProps {
  tenant: TenantInfo;
  onNavigateToMembers: () => void;
}

export function GeneralSettings({ tenant, onNavigateToMembers }: GeneralSettingsProps) {
  return (
    <>
      <Section title="Organization Info">
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
            <span style={{ color: 'var(--fg-subtle, #888)', fontSize: 14 }}>Subdomain</span>
            <span style={{ color: 'var(--fg, #fff)', fontSize: 14, fontWeight: 500 }}>{tenant.slug}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
            <span style={{ color: 'var(--fg-subtle, #888)', fontSize: 14 }}>Name</span>
            <span style={{ color: 'var(--fg, #fff)', fontSize: 14, fontWeight: 500 }}>{tenant.name}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
            <span style={{ color: 'var(--fg-subtle, #888)', fontSize: 14 }}>Seat Limit</span>
            <span style={{ color: 'var(--fg, #fff)', fontSize: 14, fontWeight: 500 }}>
              {tenant.bypassLimits ? 'Unlimited' : `${tenant.freeSeats + tenant.concurrentLimit} users`}
            </span>
          </div>
        </div>
      </Section>

      <Section title="Quick Actions">
        <div style={{ display: 'flex', gap: 12 }}>
          <Button variant="secondary" onClick={onNavigateToMembers}>
            Manage Members
          </Button>
        </div>
      </Section>
    </>
  );
}
