import { request as apiRequest, type APIRequestContext } from '@playwright/test';
import { createMailpitClient, type MailpitClient } from '../../../web/e2e/support/mailpit.js';

/** Use the existing Mailpit client and actual local mail delivery. */
export function createMailFixture() {
  let context: APIRequestContext | undefined;
  let mailpit: MailpitClient | undefined;
  async function connect() {
    if (mailpit) return mailpit;
    const base = process.env.MAILPIT_URL;
    if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
      throw new Error('The assigned local Mailpit service is missing.');
    if (!['127.0.0.1', 'localhost'].includes(process.env.MAILPIT_SMTP_HOST ?? ''))
      throw new Error('Actual local SMTP delivery is not configured.');
    const port = Number(process.env.MAILPIT_SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The assigned SMTP port is missing.');
    process.env.SMTP_HOST = process.env.MAILPIT_SMTP_HOST;
    process.env.SMTP_PORT = process.env.MAILPIT_SMTP_PORT;
    // The product only delivers with a sender; Mailpit offers STARTTLS with a self-signed certificate.
    process.env.SMTP_FROM = 'fixture-mail@example.test';
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED = 'false';
    context = await apiRequest.newContext();
    mailpit = createMailpitClient(context, base);
    return mailpit;
  }
  async function token(to: string, purpose: 'verify' | 'reset' = 'verify') {
    const client = await connect();
    const pattern = purpose === 'verify' ? /#\/verify\?token=/ : /#\/reset\?token=/;
    const message = await client.waitForMail({ to, linkPattern: pattern });
    const link = client.extractLinks(message).find((candidate) => pattern.test(candidate));
    const raw = link ? new URLSearchParams(new URL(link).hash.split('?')[1]).get('token') : null;
    if (!raw) throw new Error('The delivered email contains no expected link.');
    return raw;
  }
  return {
    connect,
    token,
    close: async () => {
      await context?.dispose();
    },
  };
}
