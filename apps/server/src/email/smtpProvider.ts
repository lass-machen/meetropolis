import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type SMTPPool from 'nodemailer/lib/smtp-pool/index.js';
import { logger } from '../logger.js';
import type { EmailProvider, SendRawParams } from './types.js';

/**
 * nodemailer-based SMTP provider.
 *
 * Design decisions from Block C:
 * - `pool` default OFF (transactional, low-frequency use case).
 * - `connectionTimeout` / `greetingTimeout` 10 s as a hard cap, so that
 *   a hanging SMTP server does not block mail delivery indefinitely.
 * - 3 retries with 800 / 1600 / 2400 ms backoff (symmetric to the
 *   EE Resend provider). On final failure `false` is returned.
 * - `verify()` is fire-and-forget detached (`void verify().catch(...)`),
 *   NEVER `await` in the boot critical path. Default: OFF.
 * - `SMTP_TLS_REJECT_UNAUTHORIZED` default `true`. Self-hosters who set
 *   it to `false` will receive a WARN log in production.
 */

export interface SmtpProviderOptions {
  host: string;
  port: number;
  /**
   * Direct TLS connection (port 465). When `false`, STARTTLS is used on
   * port 587/25. `auto` derives the mode from the port.
   */
  secure: boolean | 'auto';
  user?: string;
  pass?: string;
  from: string;
  replyTo?: string;
  pool: boolean;
  rejectUnauthorized: boolean;
  verifyOnBoot: boolean;
}

export interface SmtpProviderEnv {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  SMTP_REPLY_TO?: string;
  SMTP_POOL?: string;
  SMTP_TLS_REJECT_UNAUTHORIZED?: string;
  SMTP_VERIFY_ON_BOOT?: string;
}

const RETRY_DELAYS_MS = [800, 1600, 2400] as const;
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return fallback;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return fallback;
  return n;
}

function parseSecure(value: string | undefined, port: number): boolean {
  if (value === undefined || value === '' || value === 'auto') {
    return port === 465;
  }
  return parseBool(value, port === 465);
}

/**
 * Validates the `From` header field. nodemailer internally accepts almost
 * any string — we therefore explicitly check for the required `@` (a very
 * lenient heuristic) and for the absence of CRLF.
 *
 * We do nothing beyond that: fully RFC-compliant validation would duplicate
 * nodemailer's `addressparser` logic and produce false positives for
 * legitimate display-name forms (`"Name" <a@b>`).
 */
function validateFrom(from: string): boolean {
  if (!from || from.length === 0) return false;
  if (/[\r\n]/.test(from)) return false;
  return from.includes('@');
}

export function loadSmtpOptionsFromEnv(env: SmtpProviderEnv = process.env): SmtpProviderOptions | null {
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM?.trim();
  if (!host || !from) return null;

  const port = parsePort(env.SMTP_PORT, 587);
  const secure = parseSecure(env.SMTP_SECURE, port);

  if (!validateFrom(from)) {
    logger.warn({
      event: 'email.smtp.invalid_from',
      from,
      message: 'SMTP_FROM looks invalid (missing @ or contains CR/LF) — refusing to initialize SMTP provider',
    });
    return null;
  }

  return {
    host,
    port,
    secure,
    user: env.SMTP_USER?.trim() || undefined,
    pass: env.SMTP_PASS?.trim() || undefined,
    from,
    replyTo: env.SMTP_REPLY_TO?.trim() || undefined,
    pool: parseBool(env.SMTP_POOL, false),
    rejectUnauthorized: parseBool(env.SMTP_TLS_REJECT_UNAUTHORIZED, true),
    verifyOnBoot: parseBool(env.SMTP_VERIFY_ON_BOOT, false),
  };
}

export class SmtpEmailProvider implements EmailProvider {
  private transporter: Transporter;
  private from: string;
  private replyTo: string | undefined;

  constructor(options: SmtpProviderOptions, transporter?: Transporter) {
    this.from = options.from;
    this.replyTo = options.replyTo;
    if (transporter) {
      this.transporter = transporter;
    } else if (options.pool) {
      const poolOptions: SMTPPool.Options = {
        host: options.host,
        port: options.port,
        secure: options.secure === true,
        auth: options.user && options.pass ? { user: options.user, pass: options.pass } : undefined,
        pool: true,
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: GREETING_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
        tls: { rejectUnauthorized: options.rejectUnauthorized },
      };
      this.transporter = nodemailer.createTransport(poolOptions);
    } else {
      const smtpOptions: SMTPTransport.Options = {
        host: options.host,
        port: options.port,
        secure: options.secure === true,
        auth: options.user && options.pass ? { user: options.user, pass: options.pass } : undefined,
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: GREETING_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
        tls: { rejectUnauthorized: options.rejectUnauthorized },
      };
      this.transporter = nodemailer.createTransport(smtpOptions);
    }

    if (process.env.NODE_ENV === 'production' && !options.rejectUnauthorized) {
      logger.warn({
        event: 'email.smtp.tls_validation_disabled',
        message:
          'SMTP_TLS_REJECT_UNAUTHORIZED=false in production — only acceptable for internal relays with self-signed certs',
      });
    }

    if (options.verifyOnBoot) {
      // Fire-and-forget: NEVER await this in the boot critical path.
      void this.transporter
        .verify()
        .then(() => {
          logger.info({ event: 'email.smtp.verify_ok', host: options.host, port: options.port });
        })
        .catch((e: unknown) => {
          logger.warn({
            event: 'email.smtp.verify_failed',
            host: options.host,
            port: options.port,
            error: e instanceof Error ? e.message : String(e),
          });
        });
    }
  }

  /**
   * Closes the connection pool if active. Idempotent — can be called
   * from the server shutdown hook.
   */
  close(): void {
    try {
      this.transporter.close();
    } catch {
      // pool was never open or already closed
    }
  }

  async send(params: SendRawParams): Promise<boolean> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const info: unknown = await this.transporter.sendMail({
          from: this.from,
          to: params.to,
          subject: params.subject,
          text: params.text,
          html: params.html,
          replyTo: this.replyTo,
        });
        const messageId =
          info &&
          typeof info === 'object' &&
          'messageId' in info &&
          typeof (info as { messageId?: unknown }).messageId === 'string'
            ? (info as { messageId: string }).messageId
            : undefined;
        logger.info({
          event: 'email.smtp.send_ok',
          to: params.to,
          subject: params.subject,
          messageId,
          attempt,
        });
        return true;
      } catch (e: unknown) {
        lastError = e;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
        }
      }
    }
    logger.error({
      event: 'email.smtp.send_failed',
      to: params.to,
      subject: params.subject,
      attempts: MAX_ATTEMPTS,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
    return false;
  }
}
