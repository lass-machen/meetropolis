/**
 * Email module types for the OSS mail stack.
 *
 * The canonical interfaces live in `apps/server/src/emailLoader.ts` so
 * that the existing EE loader path can reference its contract there.
 * This module re-exports them for the OSS implementations under
 * `apps/server/src/email/*` without creating a circular dependency
 * through the loader itself.
 *
 * Additionally this module defines:
 * - `EmailProvider` — minimal `send()` interface implemented by a
 *   concrete sender (SMTP, Console).
 * - `BrandContext` — branding snapshot that is read once at provider
 *   boot and passed through to all template renderers. Template
 *   functions MUST NEVER read `process.env` directly.
 */

export type {
  EmailLocale,
  EmailModule,
  SendGuestInviteParams,
  SendInviteParams,
  SendRawParams,
  SendVerifyParams,
  SendWelcomeParams,
} from '../emailLoader.js';

import type { SendRawParams } from '../emailLoader.js';

export interface EmailProvider {
  send(params: SendRawParams): Promise<boolean>;
}

/**
 * Branding snapshot. Constructed once from ENV variables at provider
 * boot and passed as a closure parameter to all template renderers.
 */
export interface BrandContext {
  /** Display name of the platform, e.g. "Meetropolis". */
  brandName: string;
  /** Optional support email address for the footer. */
  supportEmail?: string;
}
