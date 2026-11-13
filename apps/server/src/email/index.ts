/**
 * OSS mail stack — entry point.
 *
 * `createOssEmailModule()` assembles an `EmailModule` from three parts:
 * 1. `EmailProvider` (SMTP if configured, otherwise Console)
 * 2. Template renderer (`renderForLocale`)
 * 3. Brand context + default locale (read once from ENV at boot)
 *
 * Keep the console disabled in tests. An explicitly configured SMTP provider
 * enables real Mailpit integration.
 *
 * Provider selection at boot:
 * - `SMTP_HOST` + `SMTP_FROM` set → SmtpEmailProvider.
 * - otherwise → ConsoleEmailProvider (with a WARN event).
 *
 * Brand context resolution reads `MAIL_BRAND_NAME` (default
 * "Meetropolis") and `MAIL_SUPPORT_EMAIL` (optional). These ENVs are
 * independent of the EE brand set (`BRAND_NAME` etc.) — the OSS stack
 * uses its own neutral branding.
 */

import { logger } from '../logger.js';
import { ConsoleEmailProvider } from './consoleProvider.js';
import { SmtpEmailProvider, loadSmtpOptionsFromEnv } from './smtpProvider.js';
import { readEnvDefaultLocale, resolveLocale } from './localeResolver.js';
import { renderForLocale } from './templates/index.js';
import type {
  BrandContext,
  EmailLocale,
  EmailModule,
  EmailProvider,
  SendGuestInviteParams,
  SendInviteParams,
  SendRawParams,
  SendVerifyParams,
  SendWelcomeParams,
} from './types.js';

function readBrandContext(): BrandContext {
  const brandName = process.env.MAIL_BRAND_NAME?.trim() || 'Meetropolis';
  const supportEmail = process.env.MAIL_SUPPORT_EMAIL?.trim() || undefined;
  return { brandName, supportEmail };
}

class OssEmailModule implements EmailModule {
  readonly version = 1 as const;

  constructor(
    readonly providerName: 'oss-smtp' | 'oss-console',
    private readonly provider: EmailProvider,
    private readonly brand: BrandContext,
    private readonly defaultLocale: EmailLocale,
  ) {}

  private effective(locale: EmailLocale | undefined): EmailLocale {
    return resolveLocale({ paramsLocale: locale }, this.defaultLocale);
  }

  sendInvite(params: SendInviteParams): Promise<boolean> {
    const rendered = renderForLocale(this.effective(params.locale), { kind: 'invite', params }, this.brand);
    return this.provider.send(rendered);
  }

  sendGuestInvite(params: SendGuestInviteParams): Promise<boolean> {
    const rendered = renderForLocale(this.effective(params.locale), { kind: 'guestInvite', params }, this.brand);
    return this.provider.send(rendered);
  }

  sendWelcome(params: SendWelcomeParams): Promise<boolean> {
    const rendered = renderForLocale(this.effective(params.locale), { kind: 'welcome', params }, this.brand);
    return this.provider.send(rendered);
  }

  sendVerify(params: SendVerifyParams): Promise<boolean> {
    const rendered = renderForLocale(this.effective(params.locale), { kind: 'verify', params }, this.brand);
    return this.provider.send(rendered);
  }

  sendRaw(params: SendRawParams): Promise<boolean> {
    const rendered = renderForLocale(this.defaultLocale, { kind: 'raw', params }, this.brand);
    return this.provider.send(rendered);
  }
}

/**
 * Builds the OSS EmailModule. Called by the `emailLoader.ts` resolver
 * when the EE tenancy module is not available.
 *
 * Return value:
 * - `null` in test mode without SMTP configuration.
 * - Otherwise an `EmailModule` with an SMTP or Console provider.
 */
export function createOssEmailModule(): EmailModule | null {

  const brand = readBrandContext();
  const defaultLocale = readEnvDefaultLocale();
  const smtpOptions = loadSmtpOptionsFromEnv();

  if (smtpOptions) {
    const provider = new SmtpEmailProvider(smtpOptions);
    logger.info({
      event: 'email.module_loaded',
      provider: 'oss-smtp',
      brand: brand.brandName,
      defaultLocale,
      smtpHost: smtpOptions.host,
      smtpPort: smtpOptions.port,
      smtpSecure: smtpOptions.secure,
      smtpPool: smtpOptions.pool,
      smtpVerifyOnBoot: smtpOptions.verifyOnBoot,
    });
    return new OssEmailModule('oss-smtp', provider, brand, defaultLocale);
  }

  if (process.env.NODE_ENV === 'test') return null;

  // Console fallback. Important: returns false in send() so callers know
  // no real send happened. Also emits a one-time WARN at boot.
  const provider = new ConsoleEmailProvider();
  // In production nothing is delivered without a provider: say so loudly.
  const logFallback = process.env.NODE_ENV === 'production' ? logger.error.bind(logger) : logger.warn.bind(logger);
  logFallback({
    event: 'email.fallback_console',
    message: 'No mail provider configured (SMTP_HOST/SMTP_FROM unset and no EE-tenancy module) — mails are not delivered',
    brand: brand.brandName,
    defaultLocale,
  });
  return new OssEmailModule('oss-console', provider, brand, defaultLocale);
}
