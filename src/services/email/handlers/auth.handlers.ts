/**
 * Handler gửi email liên quan xác thực và quản lý tenant.
 *
 * File này bọc EmailService với các hàm tiện dụng cho luồng auth:
 * - Gửi mã OTP đăng nhập/đăng ký
 * - Gửi email mời tham gia tổ chức (tenant)
 * - Gửi mã OTP đặt lại mật khẩu
 *
 * Mỗi hàm tự render template, đặt subject tiếng Việt, và ghi log với emailType phù hợp.
 * Module auth/tenant gọi các hàm này thay vì gọi trực tiếp EmailService.
 */

import { emailService } from '../instance';
import { getDefaultSiteName, tenantRoleLabel } from '../helpers';
import type { EmailResult } from '../types';

/**
 * Gửi email chứa mã OTP xác thực (đăng nhập, đăng ký, ...).
 * Dùng template 'otp' với userName, otpCode, expiryMinutes.
 */
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

/**
 * Gửi email mời người dùng tham gia tenant.
 * Template 'invite' hiển thị tên tenant, vai trò (đã dịch sang tiếng Việt), link chấp nhận.
 */
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

/**
 * Gửi email OTP đặt lại mật khẩu.
 * Tái sử dụng template 'otp' nhưng emailType là 'password_reset' và subject khác.
 */
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
