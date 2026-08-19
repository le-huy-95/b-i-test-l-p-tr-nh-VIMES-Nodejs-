import type { AuthMailer } from '../modules/auth/auth-mailer.port';
import { sendOtpEmail, sendPasswordResetOtpEmail } from '../services/email';

export class EmailAuthMailer implements AuthMailer {
  sendOtp(data: {
    to: string;
    userName?: string;
    otpCode: string;
    expiryMinutes: number;
    userId?: string;
  }) {
    return sendOtpEmail({
      to: data.to,
      userName: data.userName,
      otpCode: data.otpCode,
      expiryMinutes: data.expiryMinutes,
      userId: data.userId,
    });
  }

  sendPasswordResetOtp(data: {
    to: string;
    userName?: string;
    otpCode: string;
    expiryMinutes: number;
    userId?: string;
  }) {
    return sendPasswordResetOtpEmail({
      to: data.to,
      userName: data.userName,
      otpCode: data.otpCode,
      expiryMinutes: data.expiryMinutes,
      userId: data.userId,
    });
  }
}

export const authMailer = new EmailAuthMailer();
