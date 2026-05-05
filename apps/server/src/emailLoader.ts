import { logger } from './logger.js';

/**
 * OSS-Mail-Loader. Lädt das Mail-Modul aus dem privaten Tenancy-Submodul,
 * wenn vorhanden. Im OSS-Build (ohne Submodul) liefert er `null` —
 * die Aufrufer müssen dann mailfrei verfahren (Tokens/Codes via Admin-UI).
 *
 * Sensible Tokens (Password-Reset) werden NIE über dieses Modul versendet,
 * auch nicht im Tenancy-Setup.
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
  name: string;
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
 * Lädt das optionale Tenancy-Mail-Modul. Liefert `null` im OSS-Build.
 */
export async function getEmailModule(): Promise<EmailModule | null> {
  if (loadAttempted) return cached;
  loadAttempted = true;

  try {
    const modUnknown: unknown = await import('@meetropolis/tenancy');
    const root = unwrapDefaultExport(modUnknown) as Record<string, unknown> | null;
    const factory = root && typeof root === 'object' && typeof root.getEmailModule === 'function'
      ? (root.getEmailModule as () => unknown)
      : null;
    if (!factory) {
      logger.debug({ event: 'email.module_not_available', reason: 'no_factory' });
      cached = null;
      return null;
    }
    const candidate = factory();
    if (!isEmailModule(candidate)) {
      logger.warn({ event: 'email.module_invalid_shape' });
      cached = null;
      return null;
    }
    cached = candidate;
    logger.info({ event: 'email.module_loaded', provider: process.env.RESEND_API_KEY ? 'resend' : 'console' });
    return cached;
  } catch (e: unknown) {
    logger.debug({
      event: 'email.module_not_available',
      reason: 'import_failed',
      error: e instanceof Error ? e.message : String(e),
    });
    cached = null;
    return null;
  }
}

/**
 * Convenience: führt eine Mail-Aktion best-effort aus. Loggt Fehler,
 * wirft nichts. Liefert `false` wenn kein Modul oder Versand scheiterte.
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
