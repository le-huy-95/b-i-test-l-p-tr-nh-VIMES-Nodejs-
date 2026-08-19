export interface OtpIssuer {
  issueOtp(
    userId: string,
    channel: 'email' | 'phone',
    purpose: string,
    destination: string,
    userName?: string,
  ): Promise<{ expiresAt: Date }>;
  verifyOtp(input: unknown): Promise<{ verified: boolean }>;
  resendOtp(input: unknown): Promise<{ expiresAt: Date }>;
  requestPasswordReset(input: unknown): Promise<{ message: string; expiresAt?: Date }>;
  resetPasswordWithOtp(input: unknown): Promise<{ success: true }>;
}