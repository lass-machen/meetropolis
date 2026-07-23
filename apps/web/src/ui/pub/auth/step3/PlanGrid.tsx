import { useTranslation } from 'react-i18next';
import { PubBadge, PubButton } from '../../components';
import { DISPLAY_VAT_PERCENT } from '../../../../lib/vat';
import { displayPriceParts, formatMoney, localize, perParticipantFrom, type CatalogPlan } from './pricing';

interface PlanGridProps {
  plans: CatalogPlan[];
  selectedTier: string | null;
  /** Tier recommended for the chosen team size — gets the "recommended" badge. */
  recommendedTier?: string | null;
  onSelect: (tierKey: string) => void;
}

function PlanPrice({ plan, lang }: { plan: CatalogPlan; lang: string }) {
  const { t } = useTranslation('public');
  if (plan.customPricing || plan.priceAmount == null) {
    return (
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--pub-text-primary)' }}>
        {localize(plan.priceLabel, lang) || t('auth.planCustomPrice')}
      </div>
    );
  }
  const perSeat = perParticipantFrom(plan.priceAmount, plan.concurrentLimit);
  // Net stays the headline — the catalog stores net and the buyer is a business
  // (B2B-only signup). Gross sits beside the rate so all three figures are on
  // screen and reconcile, and carries the assumption footnote marker: on a
  // public page the viewer's country is unknown.
  const { net, gross, percent } = displayPriceParts(plan.priceAmount, plan.priceCurrency, lang);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 34, fontWeight: 800, color: 'var(--pub-text-primary)', lineHeight: 1 }}>{net}</span>
        <span style={{ fontSize: 14, color: 'var(--pub-text-secondary)' }}>{t('auth.perMonth')}</span>
      </div>
      <span style={{ fontSize: 12, color: 'var(--pub-text-secondary)' }}>
        {t('auth.netSuffix', { percent })} · {t('auth.grossSuffix', { gross })}
        <sup>†</sup>
      </span>
      {perSeat != null && (
        <span style={{ fontSize: 12, color: 'var(--pub-text-secondary)' }}>
          {t('auth.perParticipantFrom', { price: formatMoney(perSeat, plan.priceCurrency, lang) })}
          <sup>*</sup>
        </span>
      )}
    </div>
  );
}

/** Small pill making it obvious the plan starts as a free trial (not an instant charge). */
function TrialPill() {
  const { t } = useTranslation('public');
  return (
    <span
      style={{
        alignSelf: 'flex-start',
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--pub-accent-teal, #0d9488)',
        background: 'var(--pub-accent-teal-soft, rgba(20,184,166,0.12))',
      }}
    >
      {t('auth.trialBadge')}
    </span>
  );
}

function PlanCard({
  plan,
  selected,
  recommended,
  onSelect,
}: {
  plan: CatalogPlan;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  const { t, i18n } = useTranslation('public');
  const lang = i18n.language;
  const isEnterprise = !!plan.customPricing;
  const badge = localize(plan.badgeLabel, lang);
  const cap = plan.concurrentLimit;
  // The recommended card gets a solid accent ring even when it is not the
  // current selection, so the team-size suggestion is visible at a glance.
  const border = selected
    ? '2px solid var(--pub-accent-purple)'
    : recommended
      ? '2px solid var(--pub-accent-purple-soft, rgba(139,92,246,0.5))'
      : '1px solid var(--pub-border-light)';

  return (
    <div
      role={isEnterprise ? undefined : 'button'}
      tabIndex={isEnterprise ? undefined : 0}
      onClick={isEnterprise ? undefined : onSelect}
      onKeyDown={
        isEnterprise
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect();
              }
            }
      }
      style={{
        border,
        borderRadius: 20,
        padding: selected || recommended ? 19 : 20,
        cursor: isEnterprise ? 'default' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--pub-text-primary)' }}>
          {localize(plan.name, lang)}
        </span>
        {recommended && <PubBadge variant="purple">{t('auth.recommended')}</PubBadge>}
        {badge && !recommended && <PubBadge variant="purple">{badge}</PubBadge>}
      </div>
      <PlanPrice plan={plan} lang={lang} />
      {!isEnterprise && <TrialPill />}
      {cap != null && (
        <span style={{ fontSize: 13, color: 'var(--pub-text-secondary)' }}>{t('auth.capLabel', { count: cap })}</span>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {plan.features.map((f, idx) => (
          <li key={idx} style={{ fontSize: 13, color: 'var(--pub-text-primary)' }}>
            {localize(f, lang)}
          </li>
        ))}
      </ul>
      {isEnterprise ? (
        <PubButton
          as="a"
          href={plan.ctaUrl || 'mailto:support@meetropolis.me'}
          variant="ghost"
          style={{ width: '100%', marginTop: 'auto' }}
        >
          {t('auth.enterpriseContact')}
        </PubButton>
      ) : (
        <PubButton
          type="button"
          variant={selected ? 'primary' : 'ghost'}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          style={{ width: '100%', marginTop: 'auto' }}
        >
          {selected ? t('auth.planSelected') : t('auth.planSelect')}
        </PubButton>
      )}
    </div>
  );
}

export function PlanGrid({ plans, selectedTier, recommendedTier, onSelect }: PlanGridProps) {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 16,
        }}
      >
        {plans.map((plan) => (
          <PlanCard
            key={plan.tierKey}
            plan={plan}
            selected={selectedTier === plan.tierKey}
            recommended={!!recommendedTier && plan.tierKey === recommendedTier}
            onSelect={() => onSelect(plan.tierKey)}
          />
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--pub-text-secondary)' }}>
        <sup>*</sup> {t('auth.perParticipantFootnote')}
      </p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--pub-text-secondary)' }}>
        <sup>†</sup> {t('auth.grossAssumptionNote', { percent: DISPLAY_VAT_PERCENT })}
      </p>
    </div>
  );
}
