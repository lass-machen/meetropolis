import { PubStepIndicator } from '../components';
import { CommercialSummaryStep } from './step3/CommercialSummaryStep';
import type { TenantSignupSubmission } from './signupTypes';

interface RegisterStep4ViewProps {
  apiBase: string;
  /** Tier chosen in step 3 (regData.plan). */
  selectedTier: string;
  onSubmit: (submission: TenantSignupSubmission) => Promise<void>;
  onBack: () => void;
  error?: string | null;
  loading?: boolean;
}

/**
 * Step 4 (billing only): order overview (transparency block) plus the B2B
 * company details, then the paid order. Reached only from the commercial plan
 * step; the self-host wizard has no step 4. The four-step indicator matches the
 * one the earlier billing steps render.
 */
export function RegisterStep4View({
  apiBase,
  selectedTier,
  onSubmit,
  onBack,
  error,
  loading = false,
}: RegisterStep4ViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PubStepIndicator steps={4} currentStep={4} completedSteps={[1, 2, 3]} />
      <CommercialSummaryStep
        apiBase={apiBase}
        selectedTier={selectedTier}
        error={error}
        loading={loading}
        onSubmit={onSubmit}
        onBack={onBack}
      />
    </div>
  );
}
