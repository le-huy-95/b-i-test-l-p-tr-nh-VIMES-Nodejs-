/**
 * Adapter gửi email xác thực (OTP đăng nhập / đặt lại mật khẩu).
 *
 * Triển khai port AuthMailer của module auth, ủy thác thực tế cho
 * các hàm sendOtpEmail và sendPasswordResetOtpEmail trong services/email.
 */
import type { AuthMailer } from '../modules/auth/auth-mailer.port';
import { sendOtpEmail, sendPasswordResetOtpEmail } from '../services/email';

export class EmailAuthMailer implements AuthMailer {
  /**
   * Gửi email chứa mã OTP đăng nhập / xác minh tài khoản.
   */
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

  /**
   * Gửi email OTP cho luồng quên mật khẩu / reset password.
   */
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

/** Instance singleton inject vào auth module */
export const authMailer = new EmailAuthMailer();
