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
