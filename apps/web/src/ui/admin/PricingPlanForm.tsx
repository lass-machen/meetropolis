import React from 'react';
import type { AdminPricingPlan, I18nText } from '../billing/types';
import { Button, Card } from '../system';

interface PricingPlanFormProps {
  plan: AdminPricingPlan | null;
  onSave: (data: Partial<AdminPricingPlan>) => Promise<void>;
  onDelete?: () => Promise<void>;
  saving: boolean;
}

const emptyI18n = (): I18nText => ({ en: '', de: '' });

function defaultFormData(): Partial<AdminPricingPlan> {
  return {
    name: emptyI18n(),
    description: emptyI18n(),
    priceAmount: 0,
    priceCurrency: 'eur',
    priceInterval: 'month',
    priceLabel: emptyI18n(),
    unitLabel: emptyI18n(),
    features: [],
    ctaLabel: emptyI18n(),
    ctaUrl: '',
    highlighted: false,
    badgeLabel: emptyI18n(),
    customPricing: false,
    visible: true,
    sortOrder: 0,
    stripeProductId: null,
    stripePriceId: null,
  };
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-subtle)',
  marginBottom: 2,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  borderRadius: 6,
  border: '1px solid var(--glass-border)',
  background: 'var(--glass)',
  color: 'var(--fg)',
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
  marginBottom: 10,
};

/** Renders a pair of EN + DE text inputs for an I18nText field. */
function I18nField(props: {
  label: string;
  value: I18nText;
  onChange: (v: I18nText) => void;
  multiline?: boolean;
}) {
  const { label, value, onChange, multiline } = props;
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div style={rowStyle}>
      <div>
        <div style={labelStyle}>{label} (EN)</div>
        <Tag
          style={{ ...inputStyle, ...(multiline ? { minHeight: 48, resize: 'vertical' } : {}) }}
          value={value.en}
          onChange={(e) => onChange({ ...value, en: e.target.value })}
        />
      </div>
      <div>
        <div style={labelStyle}>{label} (DE)</div>
        <Tag
          style={{ ...inputStyle, ...(multiline ? { minHeight: 48, resize: 'vertical' } : {}) }}
          value={value.de}
          onChange={(e) => onChange({ ...value, de: e.target.value })}
        />
      </div>
    </div>
  );
}

function ToggleField(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

export function PricingPlanForm({ plan, onSave, onDelete, saving }: PricingPlanFormProps) {
  const initial = React.useMemo(() => {
    if (plan) return { ...plan };
    return defaultFormData();
  }, [plan]);

  const [data, setData] = React.useState<Partial<AdminPricingPlan>>(initial);

  // Reset when plan prop changes
  React.useEffect(() => {
    setData(plan ? { ...plan } : defaultFormData());
  }, [plan]);

  const set = <K extends keyof AdminPricingPlan>(key: K, val: AdminPricingPlan[K]) =>
    setData((prev) => ({ ...prev, [key]: val }));

  const features = (data.features ?? []) as I18nText[];

  const addFeature = () => set('features', [...features, emptyI18n()]);

  const updateFeature = (idx: number, val: I18nText) => {
    const next = [...features];
    next[idx] = val;
    set('features', next);
  };

  const removeFeature = (idx: number) => {
    set('features', features.filter((_, i) => i !== idx));
  };

  return (
    <Card style={{ padding: 12, marginTop: 8 }}>
      <I18nField label="Name" value={(data.name as I18nText) ?? emptyI18n()} onChange={(v) => set('name', v)} />
      <I18nField label="Description" value={(data.description as I18nText) ?? emptyI18n()} onChange={(v) => set('description', v)} multiline />

      {/* Toggles */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 12, flexWrap: 'wrap' }}>
        <ToggleField label="Highlighted" checked={!!data.highlighted} onChange={(v) => set('highlighted', v)} />
        <ToggleField label="Custom Pricing" checked={!!data.customPricing} onChange={(v) => set('customPricing', v)} />
        <ToggleField label="Visible" checked={data.visible !== false} onChange={(v) => set('visible', v)} />
      </div>

      {/* Badge label (only when highlighted) */}
      {data.highlighted && (
        <I18nField label="Badge Label" value={(data.badgeLabel as I18nText) ?? emptyI18n()} onChange={(v) => set('badgeLabel', v)} />
      )}

      {/* Price fields */}
      {data.customPricing ? (
        <I18nField label="Price Label" value={(data.priceLabel as I18nText) ?? emptyI18n()} onChange={(v) => set('priceLabel', v)} />
      ) : (
        <div style={{ ...rowStyle, gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div>
            <div style={labelStyle}>Price Amount (cents)</div>
            <input
              type="number"
              style={inputStyle}
              value={data.priceAmount ?? 0}
              onChange={(e) => set('priceAmount', Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <div style={labelStyle}>Currency</div>
            <input style={inputStyle} value={data.priceCurrency ?? 'eur'} onChange={(e) => set('priceCurrency', e.target.value)} />
          </div>
          <div>
            <div style={labelStyle}>Interval</div>
            <select
              style={inputStyle}
              value={data.priceInterval ?? 'month'}
              onChange={(e) => set('priceInterval', e.target.value)}
            >
              <option value="month">month</option>
              <option value="year">year</option>
            </select>
          </div>
        </div>
      )}

      <I18nField label="Unit Label" value={(data.unitLabel as I18nText) ?? emptyI18n()} onChange={(v) => set('unitLabel', v)} />
      <I18nField label="CTA Label" value={(data.ctaLabel as I18nText) ?? emptyI18n()} onChange={(v) => set('ctaLabel', v)} />

      <div style={{ marginBottom: 10 }}>
        <div style={labelStyle}>CTA URL (optional, e.g. mailto:...)</div>
        <input style={{ ...inputStyle, maxWidth: 400 }} value={data.ctaUrl ?? ''} onChange={(e) => set('ctaUrl', e.target.value)} />
      </div>

      {/* Sort order + Stripe IDs */}
      <div style={{ ...rowStyle, gridTemplateColumns: '1fr 1fr 1fr' }}>
        <div>
          <div style={labelStyle}>Sort Order</div>
          <input type="number" style={inputStyle} value={data.sortOrder ?? 0} onChange={(e) => set('sortOrder', Number(e.target.value) || 0)} />
        </div>
        <div>
          <div style={labelStyle}>Stripe Product ID</div>
          <input style={inputStyle} value={data.stripeProductId ?? ''} onChange={(e) => set('stripeProductId', e.target.value || null)} />
        </div>
        <div>
          <div style={labelStyle}>Stripe Price ID</div>
          <input style={inputStyle} value={data.stripePriceId ?? ''} onChange={(e) => set('stripePriceId', e.target.value || null)} />
        </div>
      </div>

      {/* Features */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ ...labelStyle, marginBottom: 6 }}>Features</div>
        {features.map((f, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="EN"
              value={f.en}
              onChange={(e) => updateFeature(idx, { ...f, en: e.target.value })}
            />
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="DE"
              value={f.de}
              onChange={(e) => updateFeature(idx, { ...f, de: e.target.value })}
            />
            <button
              type="button"
              onClick={() => removeFeature(idx)}
              style={{ background: 'none', border: 'none', color: 'var(--fg-subtle)', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}
            >
              &#x2715;
            </button>
          </div>
        ))}
        <Button size="sm" onClick={addFeature}>+ Feature</Button>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button onClick={() => onSave(data)} disabled={saving}>
          {saving ? 'Saving...' : plan ? 'Save Changes' : 'Create Plan'}
        </Button>
        {plan && onDelete && (
          <Button
            onClick={() => {
              if (window.confirm(`Delete plan "${plan.name.en}"?`)) {
                void onDelete();
              }
            }}
            style={{ background: 'var(--danger, #e53e3e)', color: '#fff' }}
          >
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
}
