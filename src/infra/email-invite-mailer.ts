/**
 * Adapter gửi email mời thành viên vào tenant.
 *
 * Triển khai port InviteMailer của module tenant, chuyển tiếp sang
 * sendInviteEmail trong services/email với đầy đủ thông tin lời mời.
 */
import type { InviteMailer } from '../modules/tenant/invite-mailer.port';
import { sendInviteEmail } from '../services/email';

export class EmailInviteMailer implements InviteMailer {
  /**
   * Gửi email mời user tham gia tenant với role và link accept.
   */
  sendInvite(data: {
    to: string;
    tenantName: string;
    role: string;
    inviterName: string;
    acceptUrl: string;
    expiryHours: number;
    userId?: string;
  }) {
    return sendInviteEmail({
      to: data.to,
      tenantName: data.tenantName,
      role: data.role,
      inviterName: data.inviterName,
      acceptUrl: data.acceptUrl,
      expiryHours: data.expiryHours,
      userId: data.userId,
    });
  }
}

/** Instance singleton cho tenant invite flow */
export const inviteMailer = new EmailInviteMailer();
