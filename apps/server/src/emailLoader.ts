import { logger } from './logger.js';
import { createOssEmailModule } from './email/index.js';

/**
 * OSS mail loader / resolver.
 *
 * Provider hierarchy:
 *   1. EE-tenancy (`@meetropolis/tenancy`) when the optional submodule is
 *      installed and exposes a valid `getEmailModule()` factory. The EE
 *      module itself picks Resend vs. its own console provider based on
 *      `RESEND_API_KEY` / `RESEND_FROM`.
 *   2. OSS-SMTP (`./email/index.ts`) when the EE module is unavailable but
 *      `SMTP_HOST` + `SMTP_FROM` are configured.
 *   3. OSS-Console fallback (`./email/index.ts`) when neither EE nor SMTP is
 *      configured. Logs a one-time warn at boot and reports `false` from
 *      `send()` so callers (verify-request etc.) keep surfacing tokens.
 *
 * Sensitive tokens (e.g. password reset) are never routed through this
 * module — they remain admin-triggered and surface in the admin UI.
 */

export type EmailLocale = 'de' | 'en';

export interface SendInviteParams {
  to: string;
  inviterName: string;
  tenantName: string;
  inviteUrl: string;
  locale?: EmailLocale;
}

export interface SendGuestInviteParams {
  to: string;
  inviterName: string;
  tenantName: string;
  guestName: string;
  magicLinkUrl: string;
  expiresAt: string;
  locale?: EmailLocale;
}

export interface SendWelcomeParams {
  to: string;
  /**
   * The natural person to greet. Optional and distinct from `tenantName`: when
   * the signup carried no owner name there is no person to address, and the
   * template greets neutrally ("Hallo dort" / "Hi there"). Passing the company
   * name here instead would greet a human by their employer.
   */
  name?: string;
  /** The tenant/company display name ("your office X is ready"). */
  tenantName: string;
  loginUrl: string;
  locale?: EmailLocale;
}

export interface SendVerifyParams {
  to: string;
  name: string;
  verifyUrl: string;
  locale?: EmailLocale;
}

export interface SendRawParams {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailModule {
  readonly version: 1;
  sendInvite(params: SendInviteParams): Promise<boolean>;
  sendGuestInvite(params: SendGuestInviteParams): Promise<boolean>;
  sendWelcome(params: SendWelcomeParams): Promise<boolean>;
  sendVerify(params: SendVerifyParams): Promise<boolean>;
  sendRaw(params: SendRawParams): Promise<boolean>;
}

let cached: EmailModule | null = null;
let loadAttempted = false;

function unwrapDefaultExport(moduleValue: unknown): unknown {
  if (!moduleValue || typeof moduleValue !== 'object') return moduleValue;
  if (!('default' in moduleValue)) return moduleValue;
  const withDefault = moduleValue as { default?: unknown };
  return withDefault.default ?? moduleValue;
}

function isEmailModule(value: unknown): value is EmailModule {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.sendInvite === 'function' &&
    typeof v.sendGuestInvite === 'function' &&
    typeof v.sendWelcome === 'function' &&
    typeof v.sendVerify === 'function' &&
    typeof v.sendRaw === 'function'
  );
}

/**
 * Resolve the active email module. Resolution order is EE → OSS-SMTP →
 * OSS-Console. The result is cached: ENV changes at runtime are not picked
 * up until the process restarts.
 */
export async function getEmailModule(): Promise<EmailModule | null> {
  if (loadAttempted) return cached;
  loadAttempted = true;

  // 1) EE-tenancy first.
  try {
    const modUnknown: unknown = await import('@meetropolis/tenancy');
    const root = unwrapDefaultExport(modUnknown) as Record<string, unknown> | null;
    const factory =
      root && typeof root === 'object' && typeof root.getEmailModule === 'function'
        ? (root.getEmailModule as () => unknown)
        : null;
    if (factory) {
      const candidate = factory();
      if (isEmailModule(candidate)) {
        cached = candidate;
        logger.info({
          event: 'email.module_loaded',
          provider: process.env.RESEND_API_KEY ? 'ee-resend' : 'ee-console',
        });
        return cached;
      }
      logger.warn({ event: 'email.module_invalid_shape', source: 'ee-tenancy' });
    } else {
      logger.debug({ event: 'email.module_not_available', reason: 'no_factory' });
    }
  } catch (e: unknown) {
    logger.debug({
      event: 'email.module_not_available',
      reason: 'import_failed',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 2) OSS stack (SMTP if configured, else console). Suppressed in tests.
  try {
    const ossModule = createOssEmailModule();
    if (ossModule) {
      cached = ossModule;
      return cached;
    }
  } catch (e: unknown) {
    logger.error({
      event: 'email.oss_module_init_failed',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  cached = null;
  return null;
}

/**
 * Convenience helper that runs a mail action best effort.
 * Logs errors, never throws. Returns `false` when no module is available
 * or when sending failed.
 */
export async function sendIfAvailable(
  fn: (mod: EmailModule) => Promise<boolean>,
  errorEvent: string,
  context: Record<string, unknown> = {},
): Promise<boolean> {
  const mod = await getEmailModule();
  if (!mod) return false;
  try {
    return await fn(mod);
  } catch (e: unknown) {
    logger.error({
      event: errorEvent,
      ...context,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}
