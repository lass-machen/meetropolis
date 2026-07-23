import { useTranslation } from 'react-i18next';
import { displayPriceParts, formatDate, localize, trialEndDate, type CatalogPlan } from './pricing';

interface TransparencyBlockProps {
  plan: CatalogPlan;
}

function Row({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '96px 1fr',
        gap: 16,
        padding: '8px 0',
        fontSize: 13,
        lineHeight: 1.5,
        borderTop: first ? 'none' : '1px solid var(--pub-border-light)',
      }}
    >
      <span style={{ color: 'var(--pub-text-secondary)' }}>{label}</span>
      <span style={{ color: 'var(--pub-text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

/**
 * Pre-click transparency block (E6.3): everything the customer must see on one
 * screen before ordering — package + cap, net price incl. VAT note, term and
 * renewal, the concrete trial-end date plus the amount charged afterwards, and
 * the cancellation option.
 */
export function TransparencyBlock({ plan }: TransparencyBlockProps) {
  const { t, i18n } = useTranslation('public');
  const lang = i18n.language;
  // Net is what the catalog stores and what the customer commits to; the gross
  // beside it is the German display assumption (lib/vat.ts). The real tax is
  // computed by Stripe at checkout from billing country + VAT ID — hence the
  // note below rather than a promise here.
  const parts = plan.priceAmount != null ? displayPriceParts(plan.priceAmount, plan.priceCurrency, lang) : null;
  const price = parts ? parts.net : localize(plan.priceLabel, lang);
  const priceValue = parts
    ? `${parts.net} ${t('auth.perMonth')} · ${t('auth.netSuffix', { percent: parts.percent })} · ${t('auth.grossSuffix', { gross: parts.gross })}`
    : price;
  const trialEnd = formatDate(trialEndDate(), lang);
  const capLabel = plan.concurrentLimit != null ? ` · ${t('auth.capLabel', { count: plan.concurrentLimit })}` : '';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 20px',
        borderRadius: 16,
        border: '1px solid var(--pub-border-light)',
        background: 'var(--pub-surface-subtle, rgba(0,0,0,0.02))',
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--pub-text-primary)', marginBottom: 8 }}>
        {t('auth.transparencyTitle')}
      </span>
      <Row first label={t('auth.transparencyPackage')} value={`${localize(plan.name, lang)}${capLabel}`} />
      <Row label={t('auth.transparencyPrice')} value={priceValue} />
      <Row label={t('auth.transparencyTerm')} value={t('auth.transparencyTermValue')} />
      <Row label={t('auth.transparencyTrial')} value={t('auth.transparencyTrialValue', { date: trialEnd, price })} />
      <Row label={t('auth.transparencyCancel')} value={t('auth.transparencyCancelValue')} />
      {parts && (
        <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--pub-text-secondary)' }}>
          {t('auth.grossAssumptionNote', { percent: parts.percent })}
        </p>
      )}
    </div>
  );
}
