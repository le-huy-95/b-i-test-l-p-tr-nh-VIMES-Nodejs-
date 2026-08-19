import type { InviteMailer } from '../modules/tenant/invite-mailer.port';
import { sendInviteEmail } from '../services/email';

export class EmailInviteMailer implements InviteMailer {
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

export const inviteMailer = new EmailInviteMailer();
