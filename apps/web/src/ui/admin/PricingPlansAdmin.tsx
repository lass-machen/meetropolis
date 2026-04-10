import React from 'react';
import { Button, Card } from '../system';
import { PricingPlanForm } from './PricingPlanForm';
import type { AdminPricingPlan } from '../billing/types';
import { logger } from '../../lib/logger';

interface PricingPlansAdminProps {
  apiBase: string;
}

function PlanSummary({ plan }: { plan: AdminPricingPlan }) {
  const price = plan.customPricing
    ? 'Custom'
    : plan.priceAmount != null
      ? `${(plan.priceAmount / 100).toFixed(0)} ${plan.priceCurrency.toUpperCase()}/${plan.priceInterval ?? ''}`
      : '-';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
      <span style={{ fontWeight: 600, minWidth: 120 }}>{plan.name.en || '(unnamed)'}</span>
      <span style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>#{plan.sortOrder}</span>
      <span style={{ fontSize: 13 }}>{price}</span>
      {plan.highlighted && (
        <span style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 10,
          background: 'var(--accent, #8b5cf6)',
          color: '#fff',
        }}>
          Highlighted
        </span>
      )}
      {!plan.visible && (
        <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>(hidden)</span>
      )}
    </div>
  );
}

export function PricingPlansAdmin({ apiBase }: PricingPlansAdminProps) {
  const [plans, setPlans] = React.useState<AdminPricingPlan[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [newPlan, setNewPlan] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/pricing-plans`, { credentials: 'include' });
      if (res.ok) {
        const data: { plans: AdminPricingPlan[] } = await res.json();
        setPlans(data.plans ?? []);
      }
    } catch (err) {
      logger.warn('[PricingPlansAdmin] Failed to load plans', err);
    }
    setLoading(false);
  }, [apiBase]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (planId: string | undefined, data: Partial<AdminPricingPlan>) => {
    setSaving(true);
    try {
      const isNew = !planId;
      const url = isNew ? `${apiBase}/admin/pricing-plans` : `${apiBase}/admin/pricing-plans/${planId}`;
      const method = isNew ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setNewPlan(false);
        setExpandedId(null);
        await load();
      } else {
        const err = await res.text();
        logger.warn('[PricingPlansAdmin] Save failed', err);
      }
    } catch (err) {
      logger.warn('[PricingPlansAdmin] Save error', err);
    }
    setSaving(false);
  };

  const handleDelete = async (planId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/admin/pricing-plans/${planId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setExpandedId(null);
        await load();
      }
    } catch (err) {
      logger.warn('[PricingPlansAdmin] Delete error', err);
    }
    setSaving(false);
  };

  const toggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setNewPlan(false);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Pricing Plans</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => void load()}>{loading ? 'Loading...' : 'Reload'}</Button>
          <Button onClick={() => { setNewPlan(true); setExpandedId(null); }}>+ Add Plan</Button>
        </div>
      </div>

      {loading && plans.length === 0 && (
        <Card style={{ padding: 16, textAlign: 'center', color: 'var(--fg-subtle)' }}>Loading...</Card>
      )}

      {!loading && plans.length === 0 && !newPlan && (
        <Card style={{ padding: 16, textAlign: 'center', color: 'var(--fg-subtle)' }}>
          No pricing plans configured yet.
        </Card>
      )}

      {plans.map((plan) => (
        <div key={plan.id}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggle(plan.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') toggle(plan.id); }}
            style={{ cursor: 'pointer' }}
          >
            <Card style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ marginRight: 8, fontSize: 12, color: 'var(--fg-subtle)' }}>
                  {expandedId === plan.id ? '▼' : '▶'}
                </span>
                <PlanSummary plan={plan} />
              </div>
            </Card>
          </div>
          {expandedId === plan.id && (
            <PricingPlanForm
              plan={plan}
              onSave={(data) => handleSave(plan.id, data)}
              onDelete={() => handleDelete(plan.id)}
              saving={saving}
            />
          )}
        </div>
      ))}

      {newPlan && (
        <div>
          <Card style={{ padding: '10px 14px' }}>
            <span style={{ fontWeight: 600 }}>New Plan</span>
          </Card>
          <PricingPlanForm
            plan={null}
            onSave={(data) => handleSave(undefined, data)}
            saving={saving}
          />
        </div>
      )}
    </div>
  );
}
