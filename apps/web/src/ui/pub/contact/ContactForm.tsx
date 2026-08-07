import React from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton } from '../components/PubButton';
import { PubInput } from '../components/PubInput';
import { useContactForm, type ContactTopic } from './useContactForm';

interface ContactFormProps {
  apiBase: string;
  /**
   * Shown when the form is unavailable, so the visitor still has a way to
   * write. Null in an OSS build, where no address is known — the operator's
   * own is not ours to guess, and pointing visitors at a stranger's inbox
   * would be worse than saying nothing.
   */
  fallbackEmail: string | null;
  onNavigate: (route: string) => void;
}

const TOPICS: ReadonlyArray<ContactTopic> = ['sales', 'support', 'demo', 'other'];

/** Visually hidden, but still submitted — see the honeypot note in the hook. */
const HONEYPOT_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: '-9999px',
  width: 1,
  height: 1,
  opacity: 0,
};

function StatusNote({ children, tone }: { children: React.ReactNode; tone: 'error' | 'success' | 'muted' }) {
  const color =
    tone === 'error'
      ? 'var(--pub-danger, #b3261e)'
      : tone === 'success'
        ? 'var(--pub-success, #146c2e)'
        : 'var(--pub-text-secondary)';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} style={{ fontSize: 14, lineHeight: 1.6, color, margin: 0 }}>
      {children}
    </p>
  );
}

/**
 * The send button doubles as the progress indicator for the proof-of-work.
 * It stays enabled while the work runs — pressing it simply waits for the
 * solution — because disabling a button for a reason the visitor cannot see
 * reads as a broken form.
 */
function SendButton({ status, challengeStatus }: { status: string; challengeStatus: string }) {
  const { t } = useTranslation('public');
  const busy = status === 'submitting';
  const label = busy
    ? t('contact.sending')
    : challengeStatus === 'solving'
      ? t('contact.preparing')
      : t('contact.send');
  return (
    <PubButton type="submit" variant="primary" size="lg" disabled={busy}>
      {label}
    </PubButton>
  );
}

function TopicField({ value, onChange }: { value: ContactTopic; onChange: (topic: ContactTopic) => void }) {
  const { t } = useTranslation('public');
  const id = React.useId();
  return (
    <div className="pub-input-group">
      <label htmlFor={id} className="pub-input-label">
        {t('contact.fieldTopic')}
      </label>
      <div className="pub-input-wrapper">
        <select
          id={id}
          className="pub-input"
          value={value}
          onChange={(e) => onChange(e.target.value as ContactTopic)}
          required
        >
          {TOPICS.map((topic) => (
            <option key={topic} value={topic}>
              {t(`contact.topic_${topic}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function MessageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('public');
  const id = React.useId();
  return (
    <div className="pub-input-group">
      <label htmlFor={id} className="pub-input-label">
        {t('contact.fieldMessage')}
      </label>
      <div className="pub-input-wrapper">
        <textarea
          id={id}
          className="pub-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={7}
          minLength={10}
          maxLength={5000}
          required
          style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
        />
      </div>
    </div>
  );
}

function PrivacyField({
  checked,
  onChange,
  onNavigate,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  onNavigate: (route: string) => void;
}) {
  const { t } = useTranslation('public');
  const id = React.useId();
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required
        style={{ marginTop: 3, flexShrink: 0 }}
      />
      <label htmlFor={id} style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--pub-text-secondary)' }}>
        {t('contact.privacyConsent')}{' '}
        <a
          href="#/privacy"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('privacy');
          }}
        >
          {t('contact.privacyLink')}
        </a>
      </label>
    </div>
  );
}

export function ContactForm({ apiBase, fallbackEmail, onNavigate }: ContactFormProps) {
  const { t } = useTranslation('public');
  const { values, setValue, status, challengeStatus, errorKey, submit, warmUp } = useContactForm(apiBase);

  if (status === 'checking') {
    return <StatusNote tone="muted">{t('contact.loading')}</StatusNote>;
  }

  if (status === 'unavailable') {
    return fallbackEmail ? (
      <StatusNote tone="muted">
        {t('contact.unavailableWithEmail')} <a href={`mailto:${fallbackEmail}`}>{fallbackEmail}</a>
      </StatusNote>
    ) : (
      <StatusNote tone="muted">{t('contact.unavailable')}</StatusNote>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onFocus={warmUp}
      onInput={warmUp}
      style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
      noValidate={false}
    >
      <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <PubInput
          label={t('contact.fieldName')}
          value={values.name}
          onChange={(e) => setValue('name', e.target.value)}
          autoComplete="name"
          maxLength={100}
          required
        />
        <PubInput
          label={t('contact.fieldEmail')}
          type="email"
          value={values.email}
          onChange={(e) => setValue('email', e.target.value)}
          autoComplete="email"
          maxLength={254}
          required
        />
      </div>

      <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <PubInput
          label={t('contact.fieldCompany')}
          value={values.company}
          onChange={(e) => setValue('company', e.target.value)}
          autoComplete="organization"
          maxLength={120}
        />
        <TopicField value={values.topic} onChange={(topic) => setValue('topic', topic)} />
      </div>

      <MessageField value={values.message} onChange={(v) => setValue('message', v)} />

      {/* Hidden from sight and from assistive tech; only a bot fills this in. */}
      <div style={HONEYPOT_STYLE} aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => setValue('website', e.target.value)}
        />
      </div>

      <PrivacyField
        checked={values.privacyAccepted}
        onChange={(v) => setValue('privacyAccepted', v)}
        onNavigate={onNavigate}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <SendButton status={status} challengeStatus={challengeStatus} />
        {status === 'sent' && <StatusNote tone="success">{t('contact.sent')}</StatusNote>}
        {status === 'error' && errorKey && <StatusNote tone="error">{t(errorKey)}</StatusNote>}
        <StatusNote tone="muted">{t('contact.spamNote')}</StatusNote>
      </div>
    </form>
  );
}
