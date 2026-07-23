import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { PubInput } from '../../components';
import { CURRENT_AGB_VERSION, type B2BSignupFields } from '../signupTypes';

/** Common German legal forms (proper nouns — not translated). */
const LEGAL_FORMS = [
  'GmbH',
  'UG (haftungsbeschränkt)',
  'GmbH & Co. KG',
  'AG',
  'GbR',
  'OHG',
  'KG',
  'e.K.',
  'e.V.',
  'Einzelunternehmen',
  'Freiberufler/in',
  'Sonstige',
];

/** Billing countries offered in the select (ISO 3166-1 alpha-2). */
const COUNTRY_CODES = ['DE', 'AT', 'CH', 'BE', 'DK', 'ES', 'FI', 'FR', 'IE', 'IT', 'LU', 'NL', 'PL', 'PT', 'SE'];

export interface B2BFormErrors {
  companyLegalName?: string;
  legalForm?: string;
  billingCountry?: string;
  b2bDeclaration?: string;
  agbVersion?: string;
}

interface B2BComplianceFormProps {
  value: B2BSignupFields;
  errors: B2BFormErrors;
  onChange: (patch: Partial<B2BSignupFields>) => void;
}

/**
 * Link inside the consent checkbox label. Opens in a new tab so the signup
 * state is not lost; stopPropagation keeps the click from toggling the box.
 */
function LegalLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{ color: 'var(--pub-accent-purple)', textDecoration: 'underline' }}
    >
      {children}
    </a>
  );
}

function CheckRow({
  checked,
  onToggle,
  error,
  children,
}: {
  checked: boolean;
  onToggle: (v: boolean) => void;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="pub-input-group">
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ marginTop: 2, flexShrink: 0 }}
        />
        <span style={{ color: 'var(--pub-text-primary)' }}>{children}</span>
      </label>
      {error && <span className="pub-input-error">{error}</span>}
    </div>
  );
}

function CountrySelect({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: string | undefined;
  onChange: (v: string) => void;
}) {
  const { t, i18n } = useTranslation('public');
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([i18n.language], { type: 'region' });
  } catch {
    names = null;
  }
  return (
    <div className="pub-input-group">
      <label className="pub-input-label">{t('auth.billingCountry')}</label>
      <select className="pub-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('auth.legalFormSelect')}</option>
        {COUNTRY_CODES.map((code) => (
          <option key={code} value={code}>
            {names?.of(code) ?? code}
          </option>
        ))}
      </select>
      {error && <span className="pub-input-error">{error}</span>}
    </div>
  );
}

function LegalFormSelect({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: string | undefined;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation('public');
  return (
    <div className="pub-input-group">
      <label className="pub-input-label">{t('auth.legalForm')}</label>
      <select className="pub-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('auth.legalFormSelect')}</option>
        {LEGAL_FORMS.map((form) => (
          <option key={form} value={form}>
            {form}
          </option>
        ))}
      </select>
      {error && <span className="pub-input-error">{error}</span>}
    </div>
  );
}

export function B2BComplianceForm({ value, errors, onChange }: B2BComplianceFormProps) {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2
        className="pub-text-body"
        style={{ margin: 0, fontWeight: 600, fontSize: 16, color: 'var(--pub-text-primary)' }}
      >
        {t('auth.b2bSectionTitle')}
      </h2>
      <PubInput
        label={t('auth.companyLegalName')}
        placeholder={t('auth.companyLegalNamePlaceholder')}
        value={value.companyLegalName}
        onChange={(e) => onChange({ companyLegalName: e.target.value })}
        error={errors.companyLegalName ?? ''}
        required
      />
      <LegalFormSelect value={value.legalForm} error={errors.legalForm} onChange={(v) => onChange({ legalForm: v })} />
      <CountrySelect
        value={value.billingCountry}
        error={errors.billingCountry}
        onChange={(v) => onChange({ billingCountry: v })}
      />
      <PubInput
        label={t('auth.vatId')}
        placeholder={t('auth.vatIdPlaceholder')}
        hint={t('auth.vatIdHint')}
        value={value.vatId}
        onChange={(e) => onChange({ vatId: e.target.value })}
      />
      <CheckRow
        checked={value.b2bDeclaration}
        onToggle={(v) => onChange({ b2bDeclaration: v })}
        error={errors.b2bDeclaration}
      >
        {t('auth.b2bDeclaration')}
      </CheckRow>
      <CheckRow
        checked={!!value.agbVersion}
        onToggle={(v) => onChange({ agbVersion: v ? CURRENT_AGB_VERSION : '' })}
        error={errors.agbVersion}
      >
        <Trans
          t={t}
          i18nKey="auth.agbAccept"
          components={{ termsLink: <LegalLink href="#/terms" />, privacyLink: <LegalLink href="#/privacy" /> }}
        />
      </CheckRow>
    </div>
  );
}
