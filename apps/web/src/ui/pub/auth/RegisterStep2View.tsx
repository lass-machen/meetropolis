import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PubButton, PubInput, PubStepIndicator } from '../components';
import { usePublicConfigStore } from '../../../state/publicConfigStore';
import { usePricingPlans } from './step3/usePricingPlans';
import { deriveTeamSizeOptions, type TeamSizeOption } from './step3/teamSizeRecommendation';
import { slugifyTeamName } from './slugify';

/* ---------- Inline SVG icons ---------- */

function BuildingIcon() {
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
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M12 6h.01" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 10h.01" />
      <path d="M16 14h.01" />
      <path d="M8 10h.01" />
      <path d="M8 14h.01" />
    </svg>
  );
}

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

function ArrowRightIcon() {
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
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/* ---------- Props ---------- */

interface RegisterStep2ViewProps {
  apiBase: string;
  onNext: (data: { teamName: string; teamSize: string; slug: string }) => void;
  onBack: () => void;
  initialData?: { teamName?: string; teamSize?: string; slug?: string };
  slugError?: string | null;
}

/* ---------- Constants ---------- */

// Static headcount buckets for the self-host (OSS) wizard, where there is no
// plan catalog to derive concurrency buckets from.
const STATIC_TEAM_SIZES = ['1-10', '11-50', '51-100', '100+'] as const;
const STATIC_TEAM_SIZE_KEYS: Record<string, string> = {
  '1-10': 'auth.teamSize1',
  '11-50': 'auth.teamSize2',
  '51-100': 'auth.teamSize3',
  '100+': 'auth.teamSize4',
};
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{1,2}$/;

interface SizeChoice {
  value: string;
  label: string;
}

/** Label a derived (concurrency) bucket: "bis 5", "6–15", "35+". */
function optionLabel(opt: TeamSizeOption, t: TFunction): string {
  if (opt.to == null) return t('auth.teamSizePlus', { n: opt.from - 1 });
  if (opt.from <= 1) return t('auth.teamSizeUpTo', { n: opt.to });
  return t('auth.teamSizeRange', { from: opt.from, to: opt.to });
}

/* ---------- Sub-Components ---------- */

function Step2Title() {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h1 className="pub-text-h3" style={{ margin: 0 }}>
        {t('auth.setupTeamTitle')}
      </h1>
      <p className="pub-text-body-sm" style={{ margin: 0, color: 'var(--pub-text-secondary)' }}>
        {t('auth.setupTeamSubtitle')}
      </p>
    </div>
  );
}

interface TeamSizeSelectorProps {
  label: string;
  hint?: string | undefined;
  choices: SizeChoice[];
  teamSize: string;
  onChange: (size: string) => void;
}

function TeamSizeSelector({ label, hint, choices, teamSize, onChange }: TeamSizeSelectorProps) {
  return (
    <div className="pub-input-group">
      <label className="pub-input-label">{label}</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            onClick={() => onChange(choice.value)}
            style={{
              flex: '1 1 0',
              minWidth: 70,
              padding: '10px 20px',
              borderRadius: 12,
              border:
                teamSize === choice.value ? '2px solid var(--pub-accent-purple)' : '1px solid var(--pub-border-light)',
              background: '#fff',
              color: teamSize === choice.value ? 'var(--pub-accent-purple)' : 'var(--pub-text-primary)',
              fontWeight: teamSize === choice.value ? 600 : 400,
              fontSize: 14,
              fontFamily: 'inherit',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {hint && (
        <span className="pub-text-body-sm" style={{ marginTop: 6, color: 'var(--pub-text-secondary)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}

interface SlugFieldProps {
  slug: string;
  error: string | null;
  onChange: (value: string) => void;
}

/**
 * The slug is the workspace handle (tenant identifier), not a subdomain.
 * Meetropolis runs on a single root domain and carries tenant context in the
 * auth token / X-Tenant header, so the field promises no per-team URL — it just
 * captures a unique identifier for the team.
 */
function SlugField({ slug, error, onChange }: SlugFieldProps) {
  const { t } = useTranslation('public');
  return (
    <div className="pub-input-group">
      <label className="pub-input-label">{t('auth.workspaceUrl')}</label>
      <input
        type="text"
        value={slug}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('auth.slugPlaceholder')}
        required
        style={{
          width: '100%',
          boxSizing: 'border-box',
          border: `1px solid ${error ? '#EF4444' : 'var(--pub-border-light)'}`,
          borderRadius: 12,
          outline: 'none',
          padding: '10px 16px',
          fontSize: 14,
          fontFamily: 'inherit',
          color: 'var(--pub-text-primary)',
          background: 'transparent',
          transition: 'border-color 0.15s ease',
        }}
      />
      <span className="pub-text-body-sm" style={{ marginTop: 6, color: 'var(--pub-text-secondary)' }}>
        {t('auth.workspaceUrlHint')}
      </span>
      {error && <span className="pub-input-error">{error}</span>}
    </div>
  );
}

interface Step2FieldsProps {
  teamName: string;
  teamSize: string;
  slug: string;
  slugError: string | null;
  sizeLabel: string;
  sizeHint?: string | undefined;
  sizeChoices: SizeChoice[];
  onTeamName: (v: string) => void;
  onTeamSize: (v: string) => void;
  onSlug: (v: string) => void;
}

function Step2Fields(props: Step2FieldsProps) {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PubInput
        label={t('auth.teamName')}
        icon={<BuildingIcon />}
        placeholder={t('auth.teamNamePlaceholder')}
        value={props.teamName}
        onChange={(e) => props.onTeamName(e.target.value)}
        required
      />
      <TeamSizeSelector
        label={props.sizeLabel}
        hint={props.sizeHint}
        choices={props.sizeChoices}
        teamSize={props.teamSize}
        onChange={props.onTeamSize}
      />
      <SlugField slug={props.slug} error={props.slugError} onChange={props.onSlug} />
    </div>
  );
}

function Step2Buttons({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <PubButton type="button" variant="ghost" onClick={onBack} leftIcon={<ArrowLeftIcon />}>
        {t('auth.back')}
      </PubButton>
      <PubButton type="submit" variant="primary" rightIcon={<ArrowRightIcon />} style={{ flex: 1 }}>
        {t('auth.registerSubmit')}
      </PubButton>
    </div>
  );
}

/* ---------- Component ---------- */

export function RegisterStep2View({ apiBase, onNext, onBack, initialData, slugError }: RegisterStep2ViewProps) {
  const { t } = useTranslation('public');
  const billingEnabled = usePublicConfigStore((s) => s.billingEnabled);
  // Billing: derive concurrency buckets from the live catalog so the team-size
  // options always match the buyable plans. OSS: static headcount buckets.
  const { plans } = usePricingPlans(apiBase, billingEnabled);
  const billingOptions = useMemo(
    () => (billingEnabled ? deriveTeamSizeOptions(plans ?? []) : []),
    [billingEnabled, plans],
  );

  const [teamName, setTeamName] = useState(initialData?.teamName || '');
  const [teamSize, setTeamSize] = useState(initialData?.teamSize || '1-10');
  const [slug, setSlug] = useState(initialData?.slug || '');
  const [localSlugError, setLocalSlugError] = useState<string | null>(null);
  // The identifier follows the team name until the user edits it themselves —
  // typing it by hand was pure friction in the most important funnel. Once they
  // take the field over we stop overwriting their choice, including when they
  // clear it (an empty field they emptied is still their decision). A slug
  // carried in from `initialData` counts as already-owned.
  const [slugEdited, setSlugEdited] = useState(!!initialData?.slug);

  const sizeChoices: SizeChoice[] = useMemo(() => {
    if (billingEnabled && billingOptions.length > 0) {
      return billingOptions.map((o) => ({ value: o.value, label: optionLabel(o, t) }));
    }
    return STATIC_TEAM_SIZES.map((s) => ({ value: s, label: t(STATIC_TEAM_SIZE_KEYS[s]) }));
  }, [billingEnabled, billingOptions, t]);

  useEffect(() => {
    if (slugError) setLocalSlugError(slugError);
  }, [slugError]);

  // Once the catalog loads, snap the carried default (a headcount range with no
  // billing equivalent) onto a real bucket: the highlighted plan's, else the
  // first. Guarded so it runs only while the value is not already a bucket.
  useEffect(() => {
    if (!billingEnabled || billingOptions.length === 0) return;
    if (billingOptions.some((o) => o.value === teamSize)) return;
    const highlighted = (plans ?? []).find((p) => p.highlighted && !p.customPricing);
    const fallback =
      (highlighted && billingOptions.find((o) => o.tierKey === highlighted.tierKey)) || billingOptions[0];
    setTeamSize(fallback.value);
  }, [billingEnabled, billingOptions, plans, teamSize]);

  function handleTeamNameChange(value: string) {
    setTeamName(value);
    if (slugEdited) return;
    setSlug(slugifyTeamName(value));
    setLocalSlugError(null);
  }

  function handleSlugChange(value: string) {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setSlugEdited(true);
    setSlug(cleaned);
    setLocalSlugError(null);
  }

  function validateSlug(): boolean {
    if (slug.length < 2) {
      setLocalSlugError(t('auth.slugTooShort', 'Mindestens 2 Zeichen'));
      return false;
    }
    if (!SLUG_PATTERN.test(slug)) {
      setLocalSlugError(t('auth.slugInvalid', 'Nur Kleinbuchstaben, Zahlen und Bindestriche (nicht am Anfang/Ende)'));
      return false;
    }
    return true;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateSlug()) return;
    onNext({ teamName, teamSize, slug });
  }

  const totalSteps = billingEnabled ? 4 : 3;

  return (
    <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PubStepIndicator steps={totalSteps} currentStep={2} completedSteps={[1]} />
      <Step2Title />
      <Step2Fields
        teamName={teamName}
        teamSize={teamSize}
        slug={slug}
        slugError={localSlugError}
        sizeLabel={billingEnabled ? t('auth.teamSizeConcurrent') : t('auth.teamSize')}
        sizeHint={billingEnabled ? t('auth.teamSizeConcurrentHint') : undefined}
        sizeChoices={sizeChoices}
        onTeamName={handleTeamNameChange}
        onTeamSize={setTeamSize}
        onSlug={handleSlugChange}
      />
      <Step2Buttons onBack={onBack} />
    </form>
  );
}
