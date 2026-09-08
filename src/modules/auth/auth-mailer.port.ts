/**
 * PORT GỬI EMAIL XÁC THỰC
 * -------------------------
 * Interface (hợp đồng) cho việc gửi OTP đăng ký và OTP reset mật khẩu.
 * Implementation thực tế: infra/email-auth-mailer.ts
 */
import type { EmailResult } from '../../services/email/types';

export interface AuthMailer {
  sendOtp(data: {
    to: string;
    userName?: string;
    otpCode: string;
    expiryMinutes: number;
    userId?: string;
  }): Promise<EmailResult>;

  sendPasswordResetOtp(data: {
    to: string;
    userName?: string;
    otpCode: string;
    expiryMinutes: number;
    userId?: string;
  }): Promise<EmailResult>;
}
