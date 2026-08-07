import { escapeHtml, stripCrlf } from '../../email/htmlUtils.js';
import type { EmailLocale } from '../../emailLoader.js';

/**
 * Renders the operator-facing notification for a contact-form submission.
 *
 * Every value here is written by an anonymous stranger, so the rules are
 * strict: nothing reaches an HTML body without `escapeHtml`, nothing reaches a
 * header without `stripCrlf`, and the sender's address is used as `Reply-To`
 * only — never as `From`, which has to stay on a domain we hold SPF/DKIM for.
 */

export type ContactTopic = 'sales' | 'support' | 'demo' | 'other';

export interface ContactSubmission {
  name: string;
  email: string;
  company?: string;
  topic: ContactTopic;
  message: string;
}

export interface RenderedContactMail {
  subject: string;
  text: string;
  html: string;
  replyTo: string;
}

const TOPIC_LABELS: Record<EmailLocale, Record<ContactTopic, string>> = {
  de: { sales: 'Vertrieb', support: 'Support', demo: 'Demo', other: 'Sonstiges' },
  en: { sales: 'Sales', support: 'Support', demo: 'Demo', other: 'Other' },
};

const FIELD_LABELS: Record<EmailLocale, Record<'name' | 'email' | 'company' | 'topic' | 'message', string>> = {
  de: { name: 'Name', email: 'E-Mail', company: 'Firma', topic: 'Anliegen', message: 'Nachricht' },
  en: { name: 'Name', email: 'E-mail', company: 'Company', topic: 'Topic', message: 'Message' },
};

const SUBJECT_PREFIX: Record<EmailLocale, string> = {
  de: 'Kontaktanfrage',
  en: 'Contact request',
};

/**
 * The message body is the only multi-line field. It is rendered as escaped
 * text with line breaks preserved, never as markup: whatever the sender
 * typed stays inert in the operator's mail client.
 */
function renderMessageHtml(message: string): string {
  return escapeHtml(message).replace(/\r?\n/g, '<br />');
}

function renderRow(label: string, valueHtml: string): string {
  return (
    `<tr>` +
    `<td style="padding:6px 16px 6px 0;vertical-align:top;color:#666;white-space:nowrap;">${escapeHtml(label)}</td>` +
    `<td style="padding:6px 0;vertical-align:top;color:#111;">${valueHtml}</td>` +
    `</tr>`
  );
}

function renderTextBody(submission: ContactSubmission, locale: EmailLocale): string {
  const labels = FIELD_LABELS[locale];
  const lines = [
    `${labels.name}: ${submission.name}`,
    `${labels.email}: ${submission.email}`,
    ...(submission.company ? [`${labels.company}: ${submission.company}`] : []),
    `${labels.topic}: ${TOPIC_LABELS[locale][submission.topic]}`,
    '',
    `${labels.message}:`,
    submission.message,
  ];
  return lines.join('\n');
}

function renderHtmlBody(submission: ContactSubmission, locale: EmailLocale): string {
  const labels = FIELD_LABELS[locale];
  const rows = [
    renderRow(labels.name, escapeHtml(submission.name)),
    renderRow(labels.email, `<a href="mailto:${escapeHtml(submission.email)}">${escapeHtml(submission.email)}</a>`),
    ...(submission.company ? [renderRow(labels.company, escapeHtml(submission.company))] : []),
    renderRow(labels.topic, escapeHtml(TOPIC_LABELS[locale][submission.topic])),
  ].join('');

  return (
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;">` +
    `<table style="border-collapse:collapse;margin-bottom:20px;">${rows}</table>` +
    `<div style="color:#666;margin-bottom:6px;">${escapeHtml(labels.message)}</div>` +
    `<div style="white-space:pre-wrap;color:#111;border-left:3px solid #ddd;padding-left:12px;">` +
    `${renderMessageHtml(submission.message)}</div>` +
    `</div>`
  );
}

/**
 * Build subject, bodies and reply address for one submission.
 *
 * `locale` is the *operator's* language, not the sender's: this mail is read
 * by whoever staffs the inbox, so the field labels follow the server default
 * while the message itself stays in whatever language it was written in.
 */
export function renderContactMail(submission: ContactSubmission, locale: EmailLocale): RenderedContactMail {
  const topicLabel = TOPIC_LABELS[locale][submission.topic];
  return {
    subject: stripCrlf(`[${SUBJECT_PREFIX[locale]}: ${topicLabel}] ${submission.name}`),
    text: renderTextBody(submission, locale),
    html: renderHtmlBody(submission, locale),
    replyTo: stripCrlf(submission.email),
  };
}
