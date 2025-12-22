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
    this.from = process.env.SMTP_FROM || 'noreply@meetropolis.de';
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

// Email template helpers
export const emailTemplates = {
  verifyEmail(params: { name: string; verifyUrl: string }): EmailOptions & { to: string } {
    return {
      to: '', // Set by caller
      subject: 'Verify your Meetropolis email',
      text: `Hi ${params.name || 'there'},

Please verify your email address by clicking the link below:

${params.verifyUrl}

This link will expire in 24 hours.

If you didn't create a Meetropolis account, you can safely ignore this email.

Best,
The Meetropolis Team`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Verify your email</h2>
  <p>Hi ${params.name || 'there'},</p>
  <p>Please verify your email address by clicking the button below:</p>
  <p style="margin: 30px 0;">
    <a href="${params.verifyUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Verify Email</a>
  </p>
  <p style="color: #666; font-size: 14px;">This link will expire in 24 hours.</p>
  <p style="color: #666; font-size: 14px;">If you didn't create a Meetropolis account, you can safely ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">The Meetropolis Team</p>
</body>
</html>`,
    };
  },

  resetPassword(params: { name: string; resetUrl: string }): EmailOptions & { to: string } {
    return {
      to: '', // Set by caller
      subject: 'Reset your Meetropolis password',
      text: `Hi ${params.name || 'there'},

You requested to reset your password. Click the link below to set a new password:

${params.resetUrl}

This link will expire in 30 minutes.

If you didn't request a password reset, you can safely ignore this email.

Best,
The Meetropolis Team`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Reset your password</h2>
  <p>Hi ${params.name || 'there'},</p>
  <p>You requested to reset your password. Click the button below to set a new password:</p>
  <p style="margin: 30px 0;">
    <a href="${params.resetUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Reset Password</a>
  </p>
  <p style="color: #666; font-size: 14px;">This link will expire in 30 minutes.</p>
  <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">The Meetropolis Team</p>
</body>
</html>`,
    };
  },

  welcomeTenant(params: { name: string; tenantName: string; loginUrl: string }): EmailOptions & { to: string } {
    return {
      to: '', // Set by caller
      subject: `Welcome to Meetropolis - ${params.tenantName} is ready!`,
      text: `Hi ${params.name || 'there'},

Welcome to Meetropolis! Your virtual office "${params.tenantName}" is now ready.

You can access your space here:
${params.loginUrl}

Getting started:
1. Log in with your email and password
2. Customize your avatar
3. Explore your virtual office
4. Invite your team members

If you have any questions, feel free to reach out to support@meetropolis.de.

Best,
The Meetropolis Team`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Welcome to Meetropolis!</h2>
  <p>Hi ${params.name || 'there'},</p>
  <p>Your virtual office <strong>${params.tenantName}</strong> is now ready.</p>
  <p style="margin: 30px 0;">
    <a href="${params.loginUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Enter Your Space</a>
  </p>
  <h3 style="color: #1a1a1a; margin-top: 30px;">Getting started:</h3>
  <ol style="color: #666;">
    <li>Log in with your email and password</li>
    <li>Customize your avatar</li>
    <li>Explore your virtual office</li>
    <li>Invite your team members</li>
  </ol>
  <p style="color: #666;">If you have any questions, feel free to reach out to <a href="mailto:support@meetropolis.de">support@meetropolis.de</a>.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">The Meetropolis Team</p>
</body>
</html>`,
    };
  },

  inviteToTenant(params: { inviterName: string; tenantName: string; inviteUrl: string }): EmailOptions & { to: string } {
    return {
      to: '', // Set by caller
      subject: `${params.inviterName} invited you to join ${params.tenantName} on Meetropolis`,
      text: `Hi there,

${params.inviterName} has invited you to join "${params.tenantName}" on Meetropolis.

Click the link below to accept the invitation and create your account:

${params.inviteUrl}

Meetropolis is a virtual office platform where you can work alongside your team in a spatial environment.

Best,
The Meetropolis Team`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">You're invited to Meetropolis</h2>
  <p><strong>${params.inviterName}</strong> has invited you to join <strong>${params.tenantName}</strong> on Meetropolis.</p>
  <p style="margin: 30px 0;">
    <a href="${params.inviteUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Accept Invitation</a>
  </p>
  <p style="color: #666;">Meetropolis is a virtual office platform where you can work alongside your team in a spatial environment.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">The Meetropolis Team</p>
</body>
</html>`,
    };
  },
};
