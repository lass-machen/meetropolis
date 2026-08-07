import type express from 'express';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { sendIfAvailable } from '../../emailLoader.js';
import { readEnvDefaultLocale } from '../../email/localeResolver.js';
import {
  contactChallengeRateLimiter,
  contactFormRateLimiter,
  contactFormEmailRateLimiter,
} from '../middleware/rateLimit.js';
import { isChallengeConfigured, issueChallenge, verifyChallenge } from '../utils/altchaChallenge.js';
import { renderContactMail, type ContactSubmission } from '../utils/contactMail.js';

/**
 * Public contact form: `GET /public/contact/challenge` + `POST /public/contact`.
 *
 * Opt-in per deployment. Both routes exist only when `CONTACT_FORM_TO` names a
 * recipient *and* `ALTCHA_HMAC_KEY` is set; otherwise nothing is registered and
 * the paths 404 like any other unknown route. Registering the endpoint with a
 * half-configured guard would turn it into an open relay for whoever finds it,
 * so the failure mode is "the feature does not exist", never "the feature runs
 * unprotected".
 *
 * Defence in depth, cheapest check first — an abusive request should be
 * rejected before it costs anything:
 *   1. per-IP and per-sender-address rate limits (middleware, before the body
 *      is even looked at);
 *   2. schema validation with hard length caps;
 *   3. honeypot field that a real form leaves empty;
 *   4. ALTCHA proof-of-work, signed and single-use;
 *   5. minimum fill time, derived from the signed challenge issue timestamp.
 *
 * The response is deliberately uniform: any rejection past the rate limiter
 * answers 400 with the same body. Telling a spammer which layer caught them is
 * free tuning advice for the next attempt; the real reason is logged instead.
 */

/** A person needs longer than this to read the form and write a message. */
const DEFAULT_MIN_FILL_MS = 3_000;

const contactSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(120).optional(),
  topic: z.enum(['sales', 'support', 'demo', 'other']),
  message: z.string().trim().min(10).max(5_000),
  /**
   * Explicit consent to the privacy policy. Rejected when absent — the form
   * collects personal data, and a submission without the box ticked is one we
   * have no basis to process.
   */
  privacyAccepted: z.literal(true),
  /**
   * Honeypot. Hidden from sight and from assistive technology in the client,
   * so a human never fills it; form-filling bots populate every input they
   * find. Must be absent or empty.
   */
  website: z.string().max(0).optional(),
  /** Solved ALTCHA payload; shape is validated inside `verifyChallenge`. */
  altcha: z.unknown(),
});

/** Recipient address, or null when the form is not configured. */
function readRecipient(): string | null {
  const raw = (process.env.CONTACT_FORM_TO ?? '').trim();
  return raw.length > 0 ? raw : null;
}

function readMinFillMs(): number {
  const raw = process.env.CONTACT_FORM_MIN_FILL_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MIN_FILL_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn({ event: 'contact.invalid_env', envKey: 'CONTACT_FORM_MIN_FILL_MS', value: raw });
    return DEFAULT_MIN_FILL_MS;
  }
  return parsed;
}

/**
 * The single rejection shape shared by every failed submission. See the module
 * docs for why it does not name the failing check.
 */
function rejectSubmission(res: express.Response, event: string, context: Record<string, unknown>): void {
  logger.warn({ event, ...context });
  res.status(400).json({
    success: false,
    error: { code: 'CONTACT_REJECTED', message: 'Submission rejected.' },
  });
}

async function handleChallenge(_req: express.Request, res: express.Response): Promise<void> {
  const challenge = await issueChallenge();
  if (!challenge) {
    // Unreachable while the registration guard holds; treated as a server
    // fault rather than silently handing out an unsigned challenge.
    logger.error({ event: 'contact.challenge_unavailable' });
    res.status(503).json({
      success: false,
      error: { code: 'CONTACT_UNAVAILABLE', message: 'Contact form unavailable.' },
    });
    return;
  }
  // Never cached: a reused challenge is a replayed challenge.
  res.setHeader('Cache-Control', 'no-store');
  res.json(challenge);
}

async function handleSubmission(req: express.Request, res: express.Response): Promise<void> {
  const recipient = readRecipient();
  if (!recipient) {
    logger.error({ event: 'contact.recipient_missing' });
    res.status(503).json({
      success: false,
      error: { code: 'CONTACT_UNAVAILABLE', message: 'Contact form unavailable.' },
    });
    return;
  }

  const parsed = contactSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    rejectSubmission(res, 'contact.rejected', {
      reason: 'schema',
      issues: parsed.error.issues.map((i) => i.path.join('.')),
      ip: req.ip,
    });
    return;
  }

  const { website, altcha, privacyAccepted: _privacyAccepted, ...submission } = parsed.data;
  if (website) {
    rejectSubmission(res, 'contact.rejected', { reason: 'honeypot', ip: req.ip });
    return;
  }

  const challengeResult = await verifyChallenge(altcha, readMinFillMs());
  if (!challengeResult.ok) {
    rejectSubmission(res, 'contact.rejected', { reason: challengeResult.reason, ip: req.ip });
    return;
  }

  await deliver(res, recipient, submission);
}

/**
 * Hand the submission to the mail layer and answer.
 *
 * A delivery failure is surfaced as 502 rather than swallowed: unlike the
 * password-reset flow — where a uniform response exists to prevent account
 * enumeration — there is nothing to hide here, and a visitor who is told
 * "sent" while the mail was dropped has lost their message with no way to
 * know. The body they typed is not logged; only that delivery failed.
 */
async function deliver(res: express.Response, recipient: string, submission: ContactSubmission): Promise<void> {
  const mail = renderContactMail(submission, readEnvDefaultLocale());
  const sent = await sendIfAvailable(
    (mod) =>
      mod.sendRaw({
        to: recipient,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        replyTo: mail.replyTo,
      }),
    'contact.send_failed',
    { topic: submission.topic },
  );

  if (!sent) {
    logger.error({ event: 'contact.send_failed', topic: submission.topic });
    res.status(502).json({
      success: false,
      error: { code: 'CONTACT_DELIVERY_FAILED', message: 'Message could not be delivered.' },
    });
    return;
  }

  logger.info({ event: 'contact.sent', topic: submission.topic });
  res.json({ success: true });
}

/**
 * Register the contact routes when the deployment has opted in. Silent no-op
 * otherwise, except for a one-line warning in the half-configured case, which
 * is almost always a deployment mistake worth seeing in the log.
 */
export function registerContactRoutes(app: express.Application): void {
  if (!readRecipient()) return;

  if (!isChallengeConfigured()) {
    logger.warn({
      event: 'contact.disabled_missing_hmac_key',
      detail: 'CONTACT_FORM_TO is set but ALTCHA_HMAC_KEY is not; contact form stays disabled.',
    });
    return;
  }

  app.get('/public/contact/challenge', contactChallengeRateLimiter, (req, res, next) => {
    handleChallenge(req, res).catch(next);
  });
  app.post('/public/contact', contactFormRateLimiter, contactFormEmailRateLimiter, (req, res, next) => {
    handleSubmission(req, res).catch(next);
  });

  logger.info({ event: 'contact.routes_registered' });
}
