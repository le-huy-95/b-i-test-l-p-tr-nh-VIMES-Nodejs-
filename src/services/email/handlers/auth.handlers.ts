import { emailService } from '../instance';
import { getDefaultSiteName, tenantRoleLabel } from '../helpers';
import type { EmailResult } from '../types';

export async function sendOtpEmail(data: {
  to: string;
  userName?: string;
  otpCode: string;
  expiryMinutes: number;
  userId?: string;
}): Promise<EmailResult> {
  const html = await emailService.generateTemplate('otp', {
    userName: data.userName || data.to,
    otpCode: data.otpCode,
    expiryMinutes: data.expiryMinutes,
  });
  return emailService.sendEmail(
    {
      to: data.to,
      subject: `Mã OTP - ${getDefaultSiteName()}`,
      html,
    },
    {
      emailType: 'otp',
      templateName: 'otp',
      userId: data.userId,
    },
  );
}

export async function sendInviteEmail(data: {
  to: string;
  tenantName: string;
  role: string;
  inviterName: string;
  acceptUrl: string;
  expiryHours: number;
  userId?: string;
}): Promise<EmailResult> {
  const html = await emailService.generateTemplate('invite', {
    tenantName: data.tenantName,
    role: data.role,
    roleLabel: tenantRoleLabel(data.role),
    inviterName: data.inviterName,
    acceptUrl: data.acceptUrl,
    expiryHours: data.expiryHours,
  });
  return emailService.sendEmail(
    {
      to: data.to,
      subject: `Lời mời tham gia ${data.tenantName}`,
      html,
    },
    {
      emailType: 'invite',
      templateName: 'invite',
      userId: data.userId,
    },
  );
}

export async function sendPasswordResetOtpEmail(data: {
  to: string;
  userName?: string;
  otpCode: string;
  expiryMinutes: number;
  userId?: string;
}): Promise<EmailResult> {
  const html = await emailService.generateTemplate('otp', {
    userName: data.userName || data.to,
    otpCode: data.otpCode,
    expiryMinutes: data.expiryMinutes,
  });
  return emailService.sendEmail(
    {
      to: data.to,
      subject: `Đặt lại mật khẩu - ${getDefaultSiteName()}`,
      html,
    },
    {
      emailType: 'password_reset',
      templateName: 'otp',
      userId: data.userId,
    },
  );
}
