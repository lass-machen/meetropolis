import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton } from '../../components';
import { PlanGrid } from './PlanGrid';
import { usePricingPlans } from './usePricingPlans';
import { recommendedTier as recommendTier, checkoutDefaultTier } from './teamSizeRecommendation';
import type { CatalogPlan } from './pricing';

interface CommercialPlanStepProps {
  apiBase: string;
  /** Team-size value chosen in step 2; drives the recommendation. */
  teamSize?: string | null | undefined;
  /** Tier deep-linked from the landing pricing cards, if any. */
  initialTier?: string | null | undefined;
  error?: string | null | undefined;
  loading?: boolean | undefined;
  /** Advance to the summary/company step with the chosen (payable) tier. */
  onContinue: (tierKey: string) => void;
  onBack: () => void;
}

/**
 * Preselect the tier for checkout. A valid landing deep-link wins; otherwise the
 * team-size recommendation mapped to a payable tier (custom → largest capped);
 * then the highlighted plan; then the first payable plan.
 */
function pickDefaultSelection(
  plans: CatalogPlan[],
  initial: string | null | undefined,
  recTier: string | null,
): string | null {
  if (initial && plans.some((p) => p.tierKey === initial && !p.customPricing)) return initial;
  if (recTier) {
    const fromTeamSize = checkoutDefaultTier(plans, recTier);
    if (fromTeamSize) return fromTeamSize;
  }
  const highlighted = plans.find((p) => p.highlighted && !p.customPricing);
  if (highlighted) return highlighted.tierKey;
  const firstReal = plans.find((p) => !p.customPricing);
  return firstReal ? firstReal.tierKey : null;
}

export function CommercialPlanStep({
  apiBase,
  teamSize,
  initialTier,
  error,
  loading,
  onContinue,
  onBack,
}: CommercialPlanStepProps) {
  const { t } = useTranslation('public');
  const { plans, loading: plansLoading, error: plansError, retry: retryPlans } = usePricingPlans(apiBase, true);
  const [explicitTier, setExplicitTier] = useState<string | null>(null);

  // The recommendation (badge) always follows the team size; the default
  // SELECTION derives from it but stays payable. Both are computed during render
  // so they are present on the paint the catalog arrives on.
  const recTier = useMemo(() => recommendTier(plans ?? [], teamSize), [plans, teamSize]);
  const selectedTier = useMemo(
    () => explicitTier ?? pickDefaultSelection(plans ?? [], initialTier, recTier),
    [explicitTier, plans, initialTier, recTier],
  );
  const selectedPayable = useMemo(
    () => (plans ?? []).some((p) => p.tierKey === selectedTier && !p.customPricing),
    [plans, selectedTier],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 className="pub-text-h3" style={{ margin: 0 }}>
          {t('auth.selectPlanTitle')}
        </h1>
        <p className="pub-text-body-sm" style={{ margin: 0, color: 'var(--pub-text-secondary)' }}>
          {t('auth.businessOnlyNotice')}
        </p>
      </div>

      {plansLoading && <p className="pub-text-body-sm">{t('auth.plansLoading')}</p>}
      {plansError && !plansLoading && (
        // The catalog endpoint distinguishes an outage (503) from an empty
        // catalog (200 + []), so a failure gets a retry instead of an empty
        // plan list that reads like "nothing on offer".
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <p className="pub-input-error" style={{ margin: 0 }}>
            {t('auth.plansLoadError')}
          </p>
          <PubButton type="button" variant="ghost" onClick={retryPlans}>
            {t('auth.plansRetry')}
          </PubButton>
        </div>
      )}
      {plans && plans.length > 0 && (
        <PlanGrid plans={plans} selectedTier={selectedTier} recommendedTier={recTier} onSelect={setExplicitTier} />
      )}

      {error && <span className="pub-input-error">{error}</span>}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <PubButton type="button" variant="ghost" onClick={onBack} disabled={loading}>
          {t('auth.back')}
        </PubButton>
        <PubButton
          type="button"
          variant="primary"
          onClick={() => {
            if (selectedTier && selectedPayable) onContinue(selectedTier);
          }}
          disabled={loading || plansLoading || !selectedPayable}
          style={{ flex: 1 }}
        >
          {t('auth.planContinue')}
        </PubButton>
      </div>
    </div>
  );
}
