/**
 * Email Service - Production-ready email sending infrastructure
 *
 * Supports multiple providers:
 * - SMTP (default) via nodemailer
 * - Console/Log (development fallback)
 *
 * Configure via environment variables:
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
 */

import { logger } from '../logger.js';

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Brand name used in email templates. Falls back to a neutral default for
 * OSS self-hosters who haven't installed the brand submodule. Override via
 * the `BRAND_NAME` env var. Operators of branded deployments should set this
 * to match their public brand string (e.g. `${BRAND_NAME}`).
 */
const BRAND_NAME = process.env.BRAND_NAME || 'Workspace';
const BRAND_DESCRIPTION_DE = process.env.BRAND_DESCRIPTION_DE
  || 'eine virtuelle Büro-Plattform, auf der du gemeinsam mit deinem Team in einer räumlichen Umgebung arbeiten kannst';
const BRAND_DESCRIPTION_EN = process.env.BRAND_DESCRIPTION_EN
  || 'a virtual office platform where you can work alongside your team in a spatial environment';

/**
 * Optional support contact email used in welcome/invite mails. When unset
 * (default for OSS self-hosters), the support paragraphs are omitted from
 * the templates entirely instead of leaking a brand address.
 */
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || '';

export interface EmailService {
  send(options: EmailOptions): Promise<boolean>;
}

/**
 * Console email service for development - logs emails instead of sending
 */
class ConsoleEmailService implements EmailService {
  async send(options: EmailOptions): Promise<boolean> {
    logger.info({
      event: 'email.console',
      to: options.to,
      subject: options.subject,
      preview: options.text.substring(0, 200),
    });
    console.log('\n========== EMAIL (Console Mode) ==========');
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log('-------------------------------------------');
    console.log(options.text);
    console.log('===========================================\n');
    return true;
  }
}

/**
 * SMTP email service for production
 * Requires nodemailer to be installed: npm install nodemailer @types/nodemailer
 */
class SmtpEmailService implements EmailService {
  private transporter: any = null;
  private from: string;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second

  constructor() {
    this.from = process.env.SMTP_FROM || 'noreply@example.com';
  }

  private async getTransporter() {
    if (this.transporter) return this.transporter;

    // Dynamic import to avoid requiring nodemailer in dev
    try {
      // Use dynamic import with explicit any to bypass type checking for optional dependency
      const nodemailerModule = await (Function('return import("nodemailer")')() as Promise<any>);
      const nodemailer = nodemailerModule.default || nodemailerModule;
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
        },
      });
      return this.transporter;
    } catch (e: unknown) {
      logger.error({ event: 'email.smtp.init_failed', error: e instanceof Error ? e.message : String(e) });
      throw new Error('SMTP not configured - install nodemailer: npm install nodemailer');
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async send(options: EmailOptions): Promise<boolean> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const transporter = await this.getTransporter();
        await transporter.sendMail({
          from: this.from,
          to: options.to,
          subject: options.subject,
          text: options.text,
          html: options.html,
        });
        logger.info({
          event: 'email.sent',
          to: options.to,
          subject: options.subject,
          attempt
        });
        return true;
      } catch (e: unknown) {
        lastError = e;
        logger.warn({
          event: 'email.send_attempt_failed',
          to: options.to,
          attempt,
          maxRetries: this.maxRetries,
          error: e instanceof Error ? e.message : String(e)
        });

        // Don't sleep after the last attempt
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay * attempt); // Exponential backoff
        }
      }
    }

    // All retries failed
    logger.error({
      event: 'email.send_failed',
      to: options.to,
      attempts: this.maxRetries,
      error: lastError instanceof Error ? lastError.message : String(lastError || 'Unknown error')
    });
    return false;
  }
}

/**
 * Get the appropriate email service based on configuration
 */
function createEmailService(): EmailService {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    return new SmtpEmailService();
  }
  return new ConsoleEmailService();
}

// Singleton instance
let emailServiceInstance: EmailService | null = null;

export function getEmailService(): EmailService {
  if (!emailServiceInstance) {
    emailServiceInstance = createEmailService();
  }
  return emailServiceInstance;
}

/** Supported email locales */
export type EmailLocale = 'de' | 'en';

// Email template helpers
export const emailTemplates = {
  verifyEmail(params: { name: string; verifyUrl: string; locale?: EmailLocale }): EmailOptions & { to: string } {
    const lang = params.locale || 'de';
    const nameOrFallback = params.name || (lang === 'de' ? 'dort' : 'there');

    const templates = {
      de: {
        subject: `E-Mail-Adresse bei ${BRAND_NAME} bestätigen`,
        heading: 'E-Mail bestätigen',
        greeting: `Hallo ${nameOrFallback},`,
        body: 'bitte bestätige deine E-Mail-Adresse, indem du auf den folgenden Button klickst:',
        buttonLabel: 'E-Mail bestätigen',
        expiry: 'Dieser Link ist 24 Stunden gültig.',
        ignore: `Falls du kein ${BRAND_NAME}-Konto erstellt hast, kannst du diese E-Mail ignorieren.`,
        signoff: 'Viele Grüße,',
        team: `Das ${BRAND_NAME} Team`,
      },
      en: {
        subject: `Verify your ${BRAND_NAME} email`,
        heading: 'Verify your email',
        greeting: `Hi ${nameOrFallback},`,
        body: 'Please verify your email address by clicking the button below:',
        buttonLabel: 'Verify Email',
        expiry: 'This link will expire in 24 hours.',
        ignore: `If you didn't create a ${BRAND_NAME} account, you can safely ignore this email.`,
        signoff: 'Best,',
        team: `The ${BRAND_NAME} Team`,
      },
    };

    const t = templates[lang];
    return {
      to: '', // Set by caller
      subject: t.subject,
      text: `${t.greeting}

${t.body}

${params.verifyUrl}

${t.expiry}

${t.ignore}

${t.signoff}
${t.team}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">${t.heading}</h2>
  <p>${t.greeting}</p>
  <p>${t.body}</p>
  <p style="margin: 30px 0;">
    <a href="${params.verifyUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">${t.buttonLabel}</a>
  </p>
  <p style="color: #666; font-size: 14px;">${t.expiry}</p>
  <p style="color: #666; font-size: 14px;">${t.ignore}</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">${t.team}</p>
</body>
</html>`,
    };
  },

  resetPassword(params: { name: string; resetUrl: string; locale?: EmailLocale }): EmailOptions & { to: string } {
    const lang = params.locale || 'de';
    const nameOrFallback = params.name || (lang === 'de' ? 'dort' : 'there');

    const templates = {
      de: {
        subject: `${BRAND_NAME} – Passwort zurücksetzen`,
        heading: 'Passwort zurücksetzen',
        greeting: `Hallo ${nameOrFallback},`,
        body: 'du hast angefordert, dein Passwort zurückzusetzen. Klicke auf den folgenden Button, um ein neues Passwort festzulegen:',
        buttonLabel: 'Passwort zurücksetzen',
        expiry: 'Dieser Link ist 30 Minuten gültig.',
        ignore: 'Falls du kein Zurücksetzen angefordert hast, kannst du diese E-Mail ignorieren.',
        signoff: 'Viele Grüße,',
        team: `Das ${BRAND_NAME} Team`,
      },
      en: {
        subject: `Reset your ${BRAND_NAME} password`,
        heading: 'Reset your password',
        greeting: `Hi ${nameOrFallback},`,
        body: 'You requested to reset your password. Click the button below to set a new password:',
        buttonLabel: 'Reset Password',
        expiry: 'This link will expire in 30 minutes.',
        ignore: "If you didn't request a password reset, you can safely ignore this email.",
        signoff: 'Best,',
        team: `The ${BRAND_NAME} Team`,
      },
    };

    const t = templates[lang];
    return {
      to: '', // Set by caller
      subject: t.subject,
      text: `${t.greeting}

${t.body}

${params.resetUrl}

${t.expiry}

${t.ignore}

${t.signoff}
${t.team}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">${t.heading}</h2>
  <p>${t.greeting}</p>
  <p>${t.body}</p>
  <p style="margin: 30px 0;">
    <a href="${params.resetUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">${t.buttonLabel}</a>
  </p>
  <p style="color: #666; font-size: 14px;">${t.expiry}</p>
  <p style="color: #666; font-size: 14px;">${t.ignore}</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">${t.team}</p>
</body>
</html>`,
    };
  },

  welcomeTenant(params: { name: string; tenantName: string; loginUrl: string; locale?: EmailLocale }): EmailOptions & { to: string } {
    const lang = params.locale || 'de';
    const nameOrFallback = params.name || (lang === 'de' ? 'dort' : 'there');

    const templates = {
      de: {
        subject: `Willkommen bei ${BRAND_NAME} – ${params.tenantName} ist bereit!`,
        heading: `Willkommen bei ${BRAND_NAME}!`,
        greeting: `Hallo ${nameOrFallback},`,
        body: `Dein virtuelles Büro <strong>${params.tenantName}</strong> ist jetzt bereit.`,
        bodyText: `Dein virtuelles Büro "${params.tenantName}" ist jetzt bereit.`,
        buttonLabel: 'Zum Büro',
        gettingStartedHeading: 'Erste Schritte:',
        steps: [
          'Melde dich mit deiner E-Mail-Adresse und deinem Passwort an',
          'Passe deinen Avatar an',
          'Erkunde dein virtuelles Büro',
          'Lade dein Team ein',
        ],
        support: SUPPORT_EMAIL
          ? `Bei Fragen erreichst du uns jederzeit unter <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.`
          : '',
        supportText: SUPPORT_EMAIL
          ? `Bei Fragen erreichst du uns jederzeit unter ${SUPPORT_EMAIL}.`
          : '',
        signoff: 'Viele Grüße,',
        team: `Das ${BRAND_NAME} Team`,
      },
      en: {
        subject: `Welcome to ${BRAND_NAME} - ${params.tenantName} is ready!`,
        heading: `Welcome to ${BRAND_NAME}!`,
        greeting: `Hi ${nameOrFallback},`,
        body: `Your virtual office <strong>${params.tenantName}</strong> is now ready.`,
        bodyText: `Your virtual office "${params.tenantName}" is now ready.`,
        buttonLabel: 'Enter Your Space',
        gettingStartedHeading: 'Getting started:',
        steps: [
          'Log in with your email and password',
          'Customize your avatar',
          'Explore your virtual office',
          'Invite your team members',
        ],
        support: SUPPORT_EMAIL
          ? `If you have any questions, feel free to reach out to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.`
          : '',
        supportText: SUPPORT_EMAIL
          ? `If you have any questions, feel free to reach out to ${SUPPORT_EMAIL}.`
          : '',
        signoff: 'Best,',
        team: `The ${BRAND_NAME} Team`,
      },
    };

    const t = templates[lang];
    return {
      to: '', // Set by caller
      subject: t.subject,
      text: `${t.greeting}

${t.bodyText}

${params.loginUrl}

${t.gettingStartedHeading}
${t.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${t.supportText}

${t.signoff}
${t.team}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">${t.heading}</h2>
  <p>${t.greeting}</p>
  <p>${t.body}</p>
  <p style="margin: 30px 0;">
    <a href="${params.loginUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">${t.buttonLabel}</a>
  </p>
  <h3 style="color: #1a1a1a; margin-top: 30px;">${t.gettingStartedHeading}</h3>
  <ol style="color: #666;">
    ${t.steps.map(s => `<li>${s}</li>`).join('\n    ')}
  </ol>
  <p style="color: #666;">${t.support}</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">${t.team}</p>
</body>
</html>`,
    };
  },

  guestInvite(params: { inviterName: string; tenantName: string; guestName: string; magicLinkUrl: string; expiresAt: string; locale?: EmailLocale }): EmailOptions & { to: string } {
    const lang = params.locale || 'de';
    const name = params.guestName || (lang === 'de' ? 'dort' : 'there');

    const templates = {
      de: {
        subject: `${params.inviterName} hat dich als Gast zu ${params.tenantName} eingeladen`,
        heading: 'Du wurdest als Gast eingeladen',
        greeting: `Hallo ${name},`,
        body: `<strong>${params.inviterName}</strong> hat dich als Gast zu <strong>${params.tenantName}</strong> auf ${BRAND_NAME} eingeladen.`,
        bodyText: `${params.inviterName} hat dich als Gast zu "${params.tenantName}" auf ${BRAND_NAME} eingeladen.`,
        buttonLabel: 'Als Gast beitreten',
        expiry: `Dein Zugang ist gültig bis <strong>${params.expiresAt}</strong>.`,
        expiryText: `Dein Zugang ist gültig bis ${params.expiresAt}.`,
        noPassword: 'Du benötigst kein Passwort \u2013 der Link genügt.',
        ignore: 'Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.',
        signoff: 'Viele Grüße,',
        team: `Das ${BRAND_NAME} Team`,
      },
      en: {
        subject: `${params.inviterName} invited you as a guest to ${params.tenantName}`,
        heading: "You've been invited as a guest",
        greeting: `Hi ${name},`,
        body: `<strong>${params.inviterName}</strong> has invited you as a guest to <strong>${params.tenantName}</strong> on ${BRAND_NAME}.`,
        bodyText: `${params.inviterName} has invited you as a guest to "${params.tenantName}" on ${BRAND_NAME}.`,
        buttonLabel: 'Join as Guest',
        expiry: `Your access is valid until <strong>${params.expiresAt}</strong>.`,
        expiryText: `Your access is valid until ${params.expiresAt}.`,
        noPassword: 'No password required \u2013 the link is all you need.',
        ignore: "If you didn't expect this invitation, you can safely ignore this email.",
        signoff: 'Best,',
        team: `The ${BRAND_NAME} Team`,
      },
    };

    const t = templates[lang];
    return {
      to: '', // Set by caller
      subject: t.subject,
      text: `${t.greeting}

${t.bodyText}

${params.magicLinkUrl}

${t.expiryText} ${t.noPassword}

${t.ignore}

${t.signoff}
${t.team}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">${t.heading}</h2>
  <p>${t.greeting}</p>
  <p>${t.body}</p>
  <p style="margin: 30px 0;">
    <a href="${params.magicLinkUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">${t.buttonLabel}</a>
  </p>
  <p style="color: #666; font-size: 14px;">${t.expiry}</p>
  <p style="color: #666; font-size: 14px;">${t.noPassword}</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">${t.team}</p>
</body>
</html>`,
    };
  },

  inviteToTenant(params: { inviterName: string; tenantName: string; inviteUrl: string; locale?: EmailLocale }): EmailOptions & { to: string } {
    const lang = params.locale || 'de';

    const templates = {
      de: {
        subject: `${params.inviterName} hat dich zu ${params.tenantName} auf ${BRAND_NAME} eingeladen`,
        heading: `Du wurdest zu ${BRAND_NAME} eingeladen`,
        body: `<strong>${params.inviterName}</strong> hat dich eingeladen, <strong>${params.tenantName}</strong> auf ${BRAND_NAME} beizutreten.`,
        bodyText: `${params.inviterName} hat dich eingeladen, "${params.tenantName}" auf ${BRAND_NAME} beizutreten.`,
        buttonLabel: 'Einladung annehmen',
        description: `${BRAND_NAME} ist ${BRAND_DESCRIPTION_DE}.`,
        signoff: 'Viele Grüße,',
        team: `Das ${BRAND_NAME} Team`,
      },
      en: {
        subject: `${params.inviterName} invited you to join ${params.tenantName} on ${BRAND_NAME}`,
        heading: `You're invited to ${BRAND_NAME}`,
        body: `<strong>${params.inviterName}</strong> has invited you to join <strong>${params.tenantName}</strong> on ${BRAND_NAME}.`,
        bodyText: `${params.inviterName} has invited you to join "${params.tenantName}" on ${BRAND_NAME}.`,
        buttonLabel: 'Accept Invitation',
        description: `${BRAND_NAME} is ${BRAND_DESCRIPTION_EN}.`,
        signoff: 'Best,',
        team: `The ${BRAND_NAME} Team`,
      },
    };

    const t = templates[lang];
    return {
      to: '', // Set by caller
      subject: t.subject,
      text: `${t.bodyText}

${params.inviteUrl}

${t.description}

${t.signoff}
${t.team}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">${t.heading}</h2>
  <p>${t.body}</p>
  <p style="margin: 30px 0;">
    <a href="${params.inviteUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">${t.buttonLabel}</a>
  </p>
  <p style="color: #666;">${t.description}</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">${t.team}</p>
</body>
</html>`,
    };
  },
};
