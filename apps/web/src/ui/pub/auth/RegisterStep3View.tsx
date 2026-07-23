import { useTranslation } from 'react-i18next';
import { PubButton, PubStepIndicator } from '../components';
import { usePublicConfigStore } from '../../../state/publicConfigStore';
import { CommercialPlanStep } from './step3/CommercialPlanStep';
import type { TenantSignupSubmission } from './signupTypes';

/* ---------- Props ---------- */

interface RegisterStep3ViewProps {
  apiBase: string;
  /** Team-size value from step 2; drives the plan recommendation (billing only). */
  teamSize?: string | null | undefined;
  /** Billing path: advance to the summary/company step with the chosen tier. */
  onContinue: (tierKey: string) => void;
  /** Self-host path: create the workspace directly (no plan, no company step). */
  onSubmit: (submission: TenantSignupSubmission) => Promise<void>;
  onBack: () => void;
  initialPlan?: string;
  error?: string | null;
  loading?: boolean;
}

/* ---------- Self-host (OSS) final step ---------- */
/**
 * When billing is not available (pure OSS / self-host, `billingEnabled=false`)
 * the wizard shows neither plan selection nor B2B gating — it simply creates the
 * workspace, unchanged from the pre-payment behaviour (OSS neutrality).
 */
function SelfHostFinalStep({
  onSubmit,
  onBack,
  error,
  loading,
}: {
  onSubmit: (submission: TenantSignupSubmission) => Promise<void>;
  onBack: () => void;
  error?: string | null | undefined;
  loading?: boolean | undefined;
}) {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="pub-text-h3" style={{ margin: 0 }}>
          {t('auth.finishTitle')}
        </h1>
        <p className="pub-text-body-sm" style={{ margin: 0, color: 'var(--pub-text-secondary)' }}>
          {t('auth.finishSubtitle')}
        </p>
      </div>
      {error && <span className="pub-input-error">{error}</span>}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <PubButton type="button" variant="ghost" onClick={onBack} disabled={loading}>
          {t('auth.back')}
        </PubButton>
        <PubButton
          type="button"
          variant="primary"
          onClick={() => {
            void onSubmit({ tierKey: null, b2b: null });
          }}
          disabled={loading}
          style={{ flex: 1 }}
        >
          {loading ? '...' : t('auth.createWorkspace')}
        </PubButton>
      </div>
    </div>
  );
}

/* ---------- Component ---------- */

export function RegisterStep3View({
  apiBase,
  teamSize,
  onContinue,
  onSubmit,
  onBack,
  initialPlan,
  error,
  loading = false,
}: RegisterStep3ViewProps) {
  const billingEnabled = usePublicConfigStore((s) => s.billingEnabled);
  // Billing adds a fourth step (summary + company details); self-host stays at 3.
  const totalSteps = billingEnabled ? 4 : 3;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PubStepIndicator steps={totalSteps} currentStep={3} completedSteps={[1, 2]} />
      {billingEnabled ? (
        <CommercialPlanStep
          apiBase={apiBase}
          teamSize={teamSize}
          initialTier={initialPlan ?? null}
          error={error}
          loading={loading}
          onContinue={onContinue}
          onBack={onBack}
        />
      ) : (
        <SelfHostFinalStep onSubmit={onSubmit} onBack={onBack} error={error} loading={loading} />
      )}
    </div>
  );
}
