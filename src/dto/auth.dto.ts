import { z } from 'zod';
import { normalizeEmail, normalizePhone } from '../utils/auth-normalize';

const emailField = z.preprocess(
  (val) => (typeof val === 'string' ? normalizeEmail(val) : val),
  z.string().email(),
);
const phoneField = z.preprocess(
  (val) => (typeof val === 'string' ? normalizePhone(val) : val),
  z.string().min(8),
);

export const deviceSchema = z.object({
  deviceId: z.string().min(1),
  deviceType: z.enum(['ios', 'android', 'web', 'other']),
  fcmToken: z.string().min(1).optional(),
  deviceModel: z.string().optional(),
  osVersion: z.string().optional(),
  appVersion: z.string().optional(),
  deviceInfo: z.record(z.string(), z.unknown()).optional(),
});

export const registerSchema = z
  .object({
    email: emailField.optional(),
    phone: phoneField.optional(),
    password: z.string().min(6),
    name: z.string().trim().optional(),
  })
  .refine((d) => d.email || d.phone, { message: 'Email or phone required' });

export const verifyOtpSchema = z.object({
  email: emailField.optional(),
  phone: phoneField.optional(),
  code: z.string().length(6),
});

export const loginSchema = z
  .object({
    email: emailField.optional(),
    phone: phoneField.optional(),
    password: z.string().min(1),
  })
  .refine((d) => d.email || d.phone, { message: 'Email or phone required' });

export const registerDeviceSchema = deviceSchema;

export const refreshTokenSchema = z.object({ refreshToken: z.string().min(1) });

export const resendOtpSchema = z.object({
  email: emailField.optional(),
  phone: phoneField.optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  email: emailField,
  code: z.string().length(6),
  newPassword: z.string().min(6),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
  deviceId: z.string().min(1).optional(),
});

export const googleLoginSchema = z.object({
  idToken: z.string().min(1),
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;
export type ResendOtpDto = z.infer<typeof resendOtpSchema>;
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
export type DeviceDto = z.infer<typeof deviceSchema>;
export type RegisterDeviceDto = z.infer<typeof registerDeviceSchema>;
export type LogoutDto = z.infer<typeof logoutSchema>;
export type GoogleLoginDto = z.infer<typeof googleLoginSchema>;
