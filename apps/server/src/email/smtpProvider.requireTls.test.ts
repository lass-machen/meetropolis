/**
 * The SMTP provider must not fall back to a plain-text session when the server
 * does not offer STARTTLS: that downgrade exposes the SMTP credentials and the
 * mail with its links. Checked with real nodemailer against a real SMTP server
 * that offers no STARTTLS (testUtils/plainSmtpServer.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SmtpEmailProvider, loadSmtpOptionsFromEnv, type SmtpProviderEnv } from './smtpProvider.js';
import { startPlainSmtpServer, type PlainSmtpServer } from '../testUtils/plainSmtpServer.js';

let server: PlainSmtpServer;

beforeEach(async () => {
  server = await startPlainSmtpServer();
});
afterEach(async () => {
  await server.close();
});

function provider(extra: SmtpProviderEnv): SmtpEmailProvider {
  const options = loadSmtpOptionsFromEnv({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(server.port),
    SMTP_SECURE: 'false',
    SMTP_FROM: 'Meetropolis <noreply@meetropolis.test>',
    ...extra,
  });
  if (!options) throw new Error('loadSmtpOptionsFromEnv returned null');
  return new SmtpEmailProvider(options);
}

const mail = { to: 'someone@example.test', subject: 'Einladung', text: 'secret-link', html: '<p>secret-link</p>' };

describe('SmtpEmailProvider without TLS on the server side', () => {
  it('refuses to send in plain text by default', async () => {
    const sender = provider({});
    try {
      expect(await sender.send(mail)).toBe(false);
      expect(server.received).toHaveLength(0);
    } finally {
      sender.close();
    }
  });

  it('sends in plain text only when SMTP_REQUIRE_TLS=false', async () => {
    const sender = provider({ SMTP_REQUIRE_TLS: 'false' });
    try {
      expect(await sender.send(mail)).toBe(true);
      expect(server.received).toHaveLength(1);
      expect(server.received[0]).toContain('secret-link');
    } finally {
      sender.close();
    }
  });
});
