import { logger } from '../logger.js';
import type { EmailProvider, SendRawParams } from './types.js';

/**
 * Console fallback provider for the OSS stack.
 *
 * Unlike the EE ConsoleProvider, this one returns `false` so that
 * callers (e.g. `/auth/verify/request`) know that no real delivery
 * occurred and can pass the token through the API response if needed.
 *
 * Body redaction: in production only subject and recipient domain are
 * logged — never the content. This ensures that neither reset tokens nor
 * verify URLs end up in a production logging stack. In development
 * (NODE_ENV !== 'production') the full body is printed for developer
 * convenience.
 */
export class ConsoleEmailProvider implements EmailProvider {
  send(params: SendRawParams): Promise<boolean> {
    const isProduction = process.env.NODE_ENV === 'production';
    const toDomain = params.to.includes('@') ? params.to.split('@').pop() : params.to;

    if (isProduction) {
      logger.info({
        event: 'email.console.send_redacted',
        to_domain: toDomain,
        subject: params.subject,
        body_redacted: true,
      });
    } else {
      logger.info({
        event: 'email.console.send_dev',
        to: params.to,
        subject: params.subject,
        text: params.text,
      });
    }

    return Promise.resolve(false);
  }
}
