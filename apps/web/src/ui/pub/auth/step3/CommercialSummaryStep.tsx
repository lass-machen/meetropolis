import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton } from '../../components';
import { CURRENT_AGB_VERSION, type B2BSignupFields, type TenantSignupSubmission } from '../signupTypes';
import { B2BComplianceForm, type B2BFormErrors } from './B2BComplianceForm';
import { TransparencyBlock } from './TransparencyBlock';
import { usePricingPlans } from './usePricingPlans';

interface CommercialSummaryStepProps {
  apiBase: string;
  /** Tier chosen in the plan step (regData.plan). Must be a payable plan. */
  selectedTier: string;
  error?: string | null | undefined;
  loading?: boolean | undefined;
  onSubmit: (submission: TenantSignupSubmission) => Promise<void>;
  onBack: () => void;
}

const EMPTY_B2B: B2BSignupFields = {
  companyLegalName: '',
  legalForm: '',
  billingCountry: 'DE',
  vatId: '',
  b2bDeclaration: false,
  agbVersion: '',
};

function validate(b2b: B2BSignupFields, hasPlan: boolean, t: (k: string) => string): B2BFormErrors & { plan?: string } {
  const errors: B2BFormErrors & { plan?: string } = {};
  if (!hasPlan) errors.plan = t('auth.errNoPlan');
  if (!b2b.companyLegalName.trim()) errors.companyLegalName = t('auth.errCompanyLegalName');
  if (!b2b.legalForm) errors.legalForm = t('auth.errLegalForm');
  if (!b2b.billingCountry) errors.billingCountry = t('auth.errBillingCountry');
  if (!b2b.b2bDeclaration) errors.b2bDeclaration = t('auth.errB2bDeclaration');
  if (!b2b.agbVersion) errors.agbVersion = t('auth.errAgb');
  return errors;
}

export function CommercialSummaryStep({
  apiBase,
  selectedTier,
  error,
  loading,
  onSubmit,
  onBack,
}: CommercialSummaryStepProps) {
  const { t } = useTranslation('public');
  const { plans, loading: plansLoading, error: plansError, retry: retryPlans } = usePricingPlans(apiBase, true);
  const [b2b, setB2b] = useState<B2BSignupFields>(EMPTY_B2B);
  const [errors, setErrors] = useState<B2BFormErrors & { plan?: string }>({});

  const selectedPlan = useMemo(
    () => plans?.find((p) => p.tierKey === selectedTier && !p.customPricing) ?? null,
    [plans, selectedTier],
  );

  function patchB2b(patch: Partial<B2BSignupFields>) {
    setB2b((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit() {
    const found = validate(b2b, !!selectedPlan, t);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    await onSubmit({ tierKey: selectedTier, b2b: { ...b2b, agbVersion: b2b.agbVersion || CURRENT_AGB_VERSION } });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 className="pub-text-h3" style={{ margin: 0 }}>
          {t('auth.summaryTitle')}
        </h1>
        <p className="pub-text-body-sm" style={{ margin: 0, color: 'var(--pub-text-secondary)' }}>
          {t('auth.summarySubtitle')}
        </p>
      </div>

      {plansLoading && <p className="pub-text-body-sm">{t('auth.plansLoading')}</p>}
      {plansError && !plansLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <p className="pub-input-error" style={{ margin: 0 }}>
            {t('auth.plansLoadError')}
          </p>
          <PubButton type="button" variant="ghost" onClick={retryPlans}>
            {t('auth.plansRetry')}
          </PubButton>
        </div>
      )}

      {selectedPlan && (
        <>
          <TransparencyBlock plan={selectedPlan} />
          {errors.plan && <span className="pub-input-error">{errors.plan}</span>}
          <B2BComplianceForm value={b2b} errors={errors} onChange={patchB2b} />
        </>
      )}
      {/* Catalog loaded but the carried tier is gone (edited/removed): send the
          user back to re-pick rather than stranding them on an empty summary. */}
      {plans && !plansLoading && !selectedPlan && <span className="pub-input-error">{t('auth.errNoPlan')}</span>}

      {error && <span className="pub-input-error">{error}</span>}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <PubButton type="button" variant="ghost" onClick={onBack} disabled={loading}>
          {t('auth.back')}
        </PubButton>
        <PubButton
          type="button"
          variant="primary"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={loading || plansLoading || !selectedPlan}
          style={{ flex: 1 }}
        >
          {loading ? '...' : t('auth.orderCta')}
        </PubButton>
      </div>
    </div>
  );
}
