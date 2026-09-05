import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '@dharma-events/shared';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  attachments: MailAttachment[];
}

/** Minimal mail-sending contract, so the invitation worker can be tested with a fake implementation. */
export interface Mailer {
  sendMail(message: MailMessage): Promise<void>;
}

/**
 * Nodemailer-backed SMTP mailer (REQUIREMENTS.md Section 8.4 - generic
 * SMTP, works with Gmail/Workspace/Microsoft 365/Synology MailPlus/etc).
 * Never logs `env.SMTP_PASSWORD` (Section 21 - "Never expose SMTP password
 * in logs").
 */
export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;
  private readonly fromHeader: string;

  constructor(env: Env) {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USERNAME ? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD } : undefined,
    });
    this.fromHeader = env.SMTP_FROM_NAME ? `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM_EMAIL}>` : env.SMTP_FROM_EMAIL;
  }

  async sendMail(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.fromHeader,
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments,
    });
  }
}

/**
 * Throws a clear configuration error instead of silently failing every job
 * when SMTP hasn't been configured for this deployment yet.
 */
export function createMailer(env: Env): Mailer {
  if (!env.SMTP_HOST || !env.SMTP_FROM_EMAIL) {
    return {
      async sendMail() {
        throw new Error('SMTP is not configured (SMTP_HOST/SMTP_FROM_EMAIL missing)');
      },
    };
  }
  return new SmtpMailer(env);
}
