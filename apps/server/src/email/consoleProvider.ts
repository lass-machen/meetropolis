import { logger } from '../logger.js';
import type { EmailProvider, SendRawParams } from './types.js';

/** Deliver no mail and log no mail data, including in development and tests. */
export class ConsoleEmailProvider implements EmailProvider {
  send(_params: SendRawParams): Promise<boolean> {
    logger.info({ event: 'email.console.send_redacted', body_redacted: true, delivered: false });
    return Promise.resolve(false);
  }
}
