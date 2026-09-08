/**
 * PORT GỬI EMAIL MỜI THÀNH VIÊN
 * -------------------------------
 * Interface gửi email lời mời vào tenant. Impl: infra/email-invite-mailer.ts
 */
import type { EmailResult } from '../../services/email/types';

export interface InviteMailer {
  sendInvite(data: {
    to: string;
    tenantName: string;
    role: string;
    inviterName: string;
    acceptUrl: string;
    expiryHours: number;
    userId?: string;
  }): Promise<EmailResult>;
}
