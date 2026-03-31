import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton, PubInput, PubStepIndicator } from '../components';

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
  onNext: (data: { teamName: string; teamSize: string; slug: string }) => void;
  onBack: () => void;
  initialData?: { teamName?: string; teamSize?: string; slug?: string };
  slugError?: string | null;
}

/* ---------- Constants ---------- */

const TEAM_SIZES = ['1-10', '11-50', '51-100', '100+'] as const;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{1,2}$/;

/* ---------- Component ---------- */

export function RegisterStep2View({
  onNext,
  onBack,
  initialData,
  slugError,
}: RegisterStep2ViewProps) {
  const { t } = useTranslation('public');

  const [teamName, setTeamName] = useState(initialData?.teamName || '');
  const [teamSize, setTeamSize] = useState(initialData?.teamSize || '1-10');
  const [slug, setSlug] = useState(initialData?.slug || '');
  const [localSlugError, setLocalSlugError] = useState<string | null>(null);

  // Sync external slugError into local state
  useEffect(() => {
    if (slugError) setLocalSlugError(slugError);
  }, [slugError]);

  function handleSlugChange(value: string) {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setSlug(cleaned);
    setLocalSlugError(null);
  }

  function validateSlug(): boolean {
    if (slug.length < 2) {
      setLocalSlugError(t('auth.slugTooShort', 'Mindestens 2 Zeichen'));
      return false;
    }
    if (!SLUG_PATTERN.test(slug)) {
      setLocalSlugError(
        t(
          'auth.slugInvalid',
          'Nur Kleinbuchstaben, Zahlen und Bindestriche (nicht am Anfang/Ende)',
        ),
      );
      return false;
    }
    return true;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateSlug()) return;
    onNext({ teamName, teamSize, slug });
  }

  const teamSizeKeys: Record<string, string> = {
    '1-10': 'auth.teamSize1',
    '11-50': 'auth.teamSize2',
    '51-100': 'auth.teamSize3',
    '100+': 'auth.teamSize4',
  };

  return (
    <form
      onSubmit={handleSubmit}
      autoComplete="off"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {/* Step indicator */}
      <PubStepIndicator steps={3} currentStep={2} completedSteps={[1]} />

      {/* Title */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="pub-text-h3" style={{ margin: 0 }}>
          {t('auth.setupTeamTitle')}
        </h1>
        <p
          className="pub-text-body-sm"
          style={{ margin: 0, color: 'var(--pub-text-secondary)' }}
        >
          {t('auth.setupTeamSubtitle')}
        </p>
      </div>

      {/* Form fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Team name */}
        <PubInput
          label={t('auth.teamName')}
          icon={<BuildingIcon />}
          placeholder={t('auth.teamNamePlaceholder')}
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          required
        />

        {/* Team size */}
        <div className="pub-input-group">
          <label className="pub-input-label">{t('auth.teamSize')}</label>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            {TEAM_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setTeamSize(size)}
                style={{
                  flex: '1 1 0',
                  minWidth: 70,
                  padding: '10px 20px',
                  borderRadius: 12,
                  border:
                    teamSize === size
                      ? '2px solid var(--pub-accent-purple)'
                      : '1px solid var(--pub-border-light)',
                  background: '#fff',
                  color:
                    teamSize === size
                      ? 'var(--pub-accent-purple)'
                      : 'var(--pub-text-primary)',
                  fontWeight: teamSize === size ? 600 : 400,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {t(teamSizeKeys[size])}
              </button>
            ))}
          </div>
        </div>

        {/* Workspace URL */}
        <div className="pub-input-group">
          <label className="pub-input-label">{t('auth.workspaceUrl')}</label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              border: `1px solid ${localSlugError ? '#EF4444' : 'var(--pub-border-light)'}`,
              borderRadius: 12,
              overflow: 'hidden',
              transition: 'border-color 0.15s ease',
            }}
          >
            <span
              style={{
                padding: '10px 0 10px 16px',
                color: 'var(--pub-text-secondary)',
                fontSize: 14,
                whiteSpace: 'nowrap',
                userSelect: 'none',
              }}
            >
              meetropolis.app/
            </span>
            <input
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder={t('auth.slugPlaceholder')}
              required
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                padding: '10px 16px 10px 0',
                fontSize: 14,
                fontFamily: 'inherit',
                color: 'var(--pub-text-primary)',
                background: 'transparent',
              }}
            />
          </div>
          {localSlugError && (
            <span className="pub-input-error">{localSlugError}</span>
          )}
        </div>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <PubButton
          type="button"
          variant="ghost"
          onClick={onBack}
          leftIcon={<ArrowLeftIcon />}
        >
          {t('auth.back')}
        </PubButton>
        <PubButton
          type="submit"
          variant="primary"
          rightIcon={<ArrowRightIcon />}
          style={{ flex: 1 }}
        >
          {t('auth.registerSubmit')}
        </PubButton>
      </div>
    </form>
  );
}
