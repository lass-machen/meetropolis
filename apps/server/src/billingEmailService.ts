import type { EmailModule } from './emailLoader.js';
import type { logger } from './logger.js';

export type BillingEmail = { to: string; subject: string; text: string; html: string };

export type EmailSendResult = { delivered: boolean };

export function createBillingEmailService(deps: {
  emailModule: EmailModule | null;
  delivering: boolean;
  logger: typeof logger;
}): { send(email: BillingEmail): Promise<EmailSendResult> } {
  return {
    async send(email: BillingEmail): Promise<EmailSendResult> {
      if (!deps.emailModule) {
        deps.logger.warn({ event: 'billing.email_module_unavailable', to: email.to, subject: email.subject });
        return { delivered: false };
      }
      const sent = await deps.emailModule.sendRaw(email);
      // Report real delivery so callers that archive sent letters never archive
      // console-only, skipped or failed mail (providers report failures as false).
      return { delivered: deps.delivering && sent === true };
    },
  };
}
