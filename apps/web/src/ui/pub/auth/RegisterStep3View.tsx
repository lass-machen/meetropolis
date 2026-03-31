import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton, PubBadge, PubStepIndicator } from '../components';

/* ---------- Inline SVG icons ---------- */

function ArrowLeftIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--pub-accent-teal, #14B8A6)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/* ---------- Props ---------- */

interface RegisterStep3ViewProps {
  onSubmit: (plan: string) => Promise<void>;
  onBack: () => void;
  initialPlan?: string;
  error?: string | null;
  loading?: boolean;
}

/* ---------- Plan data ---------- */

interface PlanInfo {
  id: string;
  nameKey: string;
  priceKey: string;
  features: string[];
  recommended: boolean;
}

const PLANS: PlanInfo[] = [
  {
    id: 'starter',
    nameKey: 'auth.planStarter',
    priceKey: 'auth.planStarterPrice',
    features: [
      'auth.planStarterFeature1',
      'auth.planStarterFeature2',
      'auth.planStarterFeature3',
    ],
    recommended: false,
  },
  {
    id: 'team',
    nameKey: 'auth.planTeam',
    priceKey: 'auth.planTeamPrice',
    features: [
      'auth.planTeamFeature1',
      'auth.planTeamFeature2',
      'auth.planTeamFeature3',
    ],
    recommended: true,
  },
];

/* ---------- Component ---------- */

export function RegisterStep3View({
  onSubmit,
  onBack,
  initialPlan = 'team',
  error,
  loading = false,
}: RegisterStep3ViewProps) {
  const { t } = useTranslation('public');
  const [selectedPlan, setSelectedPlan] = useState(initialPlan);

  async function handleSubmit() {
    await onSubmit(selectedPlan);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Step indicator */}
      <PubStepIndicator steps={3} currentStep={3} completedSteps={[1, 2]} />

      {/* Title */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="pub-text-h3" style={{ margin: 0 }}>
          {t('auth.selectPlanTitle')}
        </h1>
        <p
          className="pub-text-body-sm"
          style={{ margin: 0, color: 'var(--pub-text-secondary)' }}
        >
          {t('auth.selectPlanSubtitle')}
        </p>
      </div>

      {/* Plan cards */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        {PLANS.map((plan) => {
          const isSelected = selectedPlan === plan.id;

          return (
            <div
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              style={{
                flex: '1 1 0',
                minWidth: 200,
                border: isSelected
                  ? '2px solid var(--pub-accent-purple)'
                  : '1px solid var(--pub-border-light)',
                borderRadius: 20,
                padding: isSelected ? 31 : 32,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {/* Plan header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    color: plan.recommended
                      ? 'var(--pub-accent-purple)'
                      : 'var(--pub-text-secondary)',
                    fontWeight: 500,
                  }}
                >
                  {t(plan.nameKey)}
                </span>
                {plan.recommended && (
                  <PubBadge variant="purple">
                    {t('auth.planRecommended')}
                  </PubBadge>
                )}
              </div>

              {/* Price */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span
                  style={{
                    fontSize: 14,
                    color: 'var(--pub-text-secondary)',
                    fontWeight: 400,
                  }}
                >
                  &euro;
                </span>
                <span
                  style={{
                    fontSize: 40,
                    fontWeight: 800,
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    color: 'var(--pub-text-primary)',
                    lineHeight: 1,
                  }}
                >
                  {t(plan.priceKey)}
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: 'var(--pub-text-secondary)',
                    fontWeight: 400,
                  }}
                >
                  /{t('auth.planUnit')}
                </span>
              </div>

              {/* Features */}
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {plan.features.map((featureKey) => (
                  <li
                    key={featureKey}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 14,
                      color: 'var(--pub-text-primary)',
                    }}
                  >
                    <CheckIcon />
                    {t(featureKey)}
                  </li>
                ))}
              </ul>

              {/* Select button */}
              <PubButton
                type="button"
                variant={isSelected ? 'primary' : 'ghost'}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPlan(plan.id);
                }}
                style={{ width: '100%', marginTop: 'auto' }}
              >
                {t('auth.planSelect')}
              </PubButton>
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#EF4444',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <PubButton
          type="button"
          variant="ghost"
          onClick={onBack}
          leftIcon={<ArrowLeftIcon />}
          disabled={loading}
        >
          {t('auth.back')}
        </PubButton>
        <PubButton
          type="button"
          variant="primary"
          onClick={handleSubmit}
          disabled={loading}
          style={{ flex: 1 }}
        >
          {loading ? '...' : `${t('auth.trialStart')} \u{1F680}`}
        </PubButton>
      </div>

      {/* Trial hint */}
      <p
        className="pub-text-body-sm"
        style={{
          margin: 0,
          textAlign: 'center',
          color: 'var(--pub-text-secondary)',
          fontSize: 12,
        }}
      >
        {t('auth.trialHint')}
      </p>
    </div>
  );
}
