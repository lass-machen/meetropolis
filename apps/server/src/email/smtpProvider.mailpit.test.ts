/**
 * Live SMTP integration test for the OSS SmtpEmailProvider against a Mailpit
 * server that *requires* STARTTLS. It drives the real nodemailer send path
 * end-to-end — createTransport, the opportunistic STARTTLS upgrade, sendMail,
 * real socket — which the plain unit tests never touch. This is the coverage
 * that makes a nodemailer major bump verifiable instead of merely "CI is green":
 * nodemailer 9 hardened exactly the STARTTLS / secure-socket handling this test
 * exercises.
 *
 * Opt-in. It only runs with MAILPIT_ITEST=1 AND a reachable Mailpit; otherwise
 * the whole describe block is skipped, so the regular test suite / CI (which has
 * no Mailpit) is unaffected. Bring the server up with:
 *
 *   docker run -d -p 1025:1025 -p 8025:8025 \
 *     -v $PWD/cert.pem:/cert.pem:ro -v $PWD/key.pem:/key.pem:ro \
 *     -e MP_SMTP_TLS_CERT=/cert.pem -e MP_SMTP_TLS_KEY=/key.pem \
 *     -e MP_SMTP_REQUIRE_STARTTLS=true axllent/mailpit
 *
 * then: MAILPIT_ITEST=1 npm -w @meetropolis/server exec vitest run \
 *         src/email/smtpProvider.mailpit.test.ts
 *
 * Overridable via MAILPIT_API_URL / MAILPIT_SMTP_HOST / MAILPIT_SMTP_PORT.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SmtpEmailProvider, loadSmtpOptionsFromEnv } from './smtpProvider.js';

const ENABLED = process.env.MAILPIT_ITEST === '1';
const API = process.env.MAILPIT_API_URL ?? 'http://127.0.0.1:8025';
const SMTP_HOST = process.env.MAILPIT_SMTP_HOST ?? '127.0.0.1';
const SMTP_PORT = process.env.MAILPIT_SMTP_PORT ?? '1025';
const FROM = 'Meetropolis <noreply@meetropolis.test>';

interface MailpitAddress {
  Name: string;
  Address: string;
}
interface MailpitSummary {
  ID: string;
  Subject: string;
  From: MailpitAddress;
  To: MailpitAddress[];
}
interface MailpitMessage extends MailpitSummary {
  Text: string;
  HTML: string;
}

async function clearMailbox(): Promise<void> {
  await fetch(`${API}/api/v1/messages`, { method: 'DELETE' });
}

async function findBySubject(subject: string, timeoutMs = 5000): Promise<MailpitMessage | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${API}/api/v1/messages`);
    const body = (await res.json()) as { messages: MailpitSummary[] };
    const hit = body.messages.find((m) => m.Subject === subject);
    if (hit) {
      const detail = await fetch(`${API}/api/v1/message/${hit.ID}`);
      return (await detail.json()) as MailpitMessage;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function providerFor(pool: boolean): SmtpEmailProvider {
  const options = loadSmtpOptionsFromEnv({
    SMTP_HOST,
    SMTP_PORT,
    // secure=false => plain connect on 587-style port + opportunistic STARTTLS,
    // which the require-STARTTLS Mailpit forces the client to actually perform.
    SMTP_SECURE: 'false',
    SMTP_FROM: FROM,
    SMTP_POOL: pool ? 'true' : 'false',
    // The test container uses a self-signed cert.
    SMTP_TLS_REJECT_UNAUTHORIZED: 'false',
  });
  if (!options) throw new Error('loadSmtpOptionsFromEnv returned null — check MAILPIT_* test env');
  return new SmtpEmailProvider(options);
}

describe.skipIf(!ENABLED)('SmtpEmailProvider against Mailpit (nodemailer 9, STARTTLS required)', () => {
  let provider: SmtpEmailProvider;

  beforeAll(() => {
    provider = providerFor(false);
  });
  afterAll(() => provider.close());
  afterEach(() => clearMailbox());

  it('delivers a message end-to-end over a STARTTLS-required connection', async () => {
    await clearMailbox();
    const subject = `mp-deliver-${Date.now()}`;
    const to = 'recipient@example.test';

    // A false return means all send attempts failed — e.g. if v9 STARTTLS
    // handling had regressed against this server, the require-STARTTLS Mailpit
    // would reject a plain session and this would be false.
    const ok = await provider.send({
      to,
      subject,
      text: 'plain-text body — ae oe ue',
      html: '<p>html body <strong>ok</strong></p>',
    });
    expect(ok).toBe(true);

    const msg = await findBySubject(subject);
    expect(msg).not.toBeNull();
    expect(msg!.To[0]?.Address).toBe(to);
    expect(msg!.From.Address).toBe('noreply@meetropolis.test');
    expect(msg!.HTML).toContain('html body');
    expect(msg!.Text).toContain('plain-text body');
  });

  it('delivers through the pooled transport path as well', async () => {
    await clearMailbox();
    const pooled = providerFor(true);
    try {
      const subject = `mp-pool-${Date.now()}`;
      const ok = await pooled.send({
        to: 'pool@example.test',
        subject,
        text: 'pooled body',
        html: '<p>pooled</p>',
      });
      expect(ok).toBe(true);

      const msg = await findBySubject(subject);
      expect(msg).not.toBeNull();
      expect(msg!.To[0]?.Address).toBe('pool@example.test');
    } finally {
      pooled.close();
    }
  });
});
