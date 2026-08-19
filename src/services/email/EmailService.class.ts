import nodemailer from 'nodemailer';
import type { PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { getMailTransporter, isUsingEthereal } from '../../infra/smtp';
import { env, isSmtpConfigured } from '../../config/env';
import { templateLoader } from './template-loader';
import {
  createTemplateData,
  formatEmailList,
  getDefaultFromAddress,
  normalizeEmailArray,
} from './helpers';
import type { EmailLogOptions, EmailResult, SendEmailOptions } from './types';

export class EmailService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async generateTemplate(templateName: string, data: Record<string, unknown>): Promise<string> {
    const template = await templateLoader.getTemplate(templateName);
    return template(createTemplateData(data));
  }

  async sendEmail(options: SendEmailOptions, logOptions?: EmailLogOptions): Promise<EmailResult> {
    try {
      const to = normalizeEmailArray(options.to);
      const from = options.from || getDefaultFromAddress();
      const fromName = options.fromName || env.DEFAULT_FROM_NAME;

      const log = await this.db.sendEmailLog.create({
        data: {
          userId: logOptions?.userId,
          from,
          fromName,
          to,
          cc: options.cc ? normalizeEmailArray(options.cc) : undefined,
          bcc: options.bcc ? normalizeEmailArray(options.bcc) : undefined,
          replyTo: options.replyTo,
          subject: options.subject,
          emailType: logOptions?.emailType || 'general',
          templateName: logOptions?.templateName,
          htmlContent: options.html,
          status: 'pending',
          metadata: logOptions?.metadata ? (logOptions.metadata as object) : undefined,
        },
      });

      await this.dispatchLog(log.id);

      return {
        success: true,
        message: `Email processed for ${formatEmailList(to)}`,
        logId: log.id,
      };
    } catch (error: unknown) {
      console.error('[EmailService] create/send failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Không thể gửi email',
      };
    }
  }

  async dispatchLog(logId: string): Promise<void> {
    const log = await this.db.sendEmailLog.findUnique({ where: { id: logId } });
    if (!log || log.status !== 'pending') return;

    const transporter = await getMailTransporter();
    if (!transporter) {
      const msg = isSmtpConfigured()
        ? 'SMTP transporter unavailable'
        : 'SMTP not configured';
      console.warn(`[EmailService] ${msg}: ${logId}`);
      if (!isSmtpConfigured() && env.NODE_ENV === 'development') {
        await this.db.sendEmailLog.update({
          where: { id: logId },
          data: {
            status: 'success',
            sentAt: new Date(),
            error: 'DEV_SKIP_SMTP',
          },
        });
        console.log(`[EmailService] DEV skip send: ${log.subject} -> ${JSON.stringify(log.to)}`);
        return;
      }
      await this.db.sendEmailLog.update({
        where: { id: logId },
        data: { status: 'failed', error: msg },
      });
      throw new Error(msg);
    }

    try {
      const to = Array.isArray(log.to) ? (log.to as string[]) : [];
      const info = await transporter.sendMail({
        from: log.fromName ? `"${log.fromName}" <${log.from}>` : log.from,
        to,
        cc: log.cc ? (log.cc as string[]) : undefined,
        bcc: log.bcc ? (log.bcc as string[]) : undefined,
        replyTo: log.replyTo ?? undefined,
        subject: log.subject,
        html: log.htmlContent,
      });

      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log(`[EmailService] Preview: ${previewUrl}`);
      } else if (isUsingEthereal()) {
        console.log(`[EmailService] Sent via Ethereal (no preview URL) -> ${JSON.stringify(to)}`);
      }

      await this.db.sendEmailLog.update({
        where: { id: logId },
        data: { status: 'success', sentAt: new Date() },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Send failed';
      await this.db.sendEmailLog.update({
        where: { id: logId },
        data: { status: 'failed', error: message },
      });
      throw error;
    }
  }
}
