/**
 * Lớp dịch vụ gửi email cốt lõi.
 *
 * EmailService chịu trách nhiệm toàn bộ luồng gửi email:
 * 1. Render HTML từ template Handlebars (`generateTemplate`)
 * 2. Tạo bản ghi log trạng thái `pending` trong DB (`sendEmail`)
 * 3. Dispatch qua SMTP transporter và cập nhật log `success`/`failed` (`dispatchLog`)
 *
 * Hỗ trợ chế độ dev: khi SMTP chưa cấu hình, đánh dấu log thành công với flag DEV_SKIP_SMTP.
 * Inject Prisma client qua constructor để dễ test với mock DB.
 */

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

/** Dịch vụ email — inject Prisma client (mặc định dùng singleton prisma) */
export class EmailService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Render template Handlebars thành chuỗi HTML.
   * Tự động bổ sung biến mặc định (siteName, siteUrl, currentYear) qua `createTemplateData`.
   */
  async generateTemplate(templateName: string, data: Record<string, unknown>): Promise<string> {
    const template = await templateLoader.getTemplate(templateName);
    return template(createTemplateData(data));
  }

  /**
   * Tạo log email và kích hoạt gửi (dispatch).
   *
   * Luồng xử lý:
   * - Chuẩn hóa người nhận, lấy from/fromName mặc định nếu thiếu
   * - Ghi bản ghi `sendEmailLog` với status `pending`
   * - Gọi `dispatchLog` để gửi thực tế qua SMTP
   * - Trả về `EmailResult` — không throw khi lỗi tạo log (trả success: false)
   */
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

  /**
   * Gửi email thực tế qua SMTP cho một bản ghi log đang `pending`.
   *
   * Xử lý các trường hợp:
   * - Log không tồn tại hoặc không còn `pending` → bỏ qua
   * - Không có transporter: dev + chưa cấu hình SMTP → đánh dấu success (DEV_SKIP_SMTP)
   * - Không có transporter: production → failed và throw
   * - Gửi thành công → cập nhật `success`, `sentAt`; in preview URL nếu dùng Ethereal
   * - Gửi thất bại → cập nhật `failed`, `error`, re-throw
   */
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
