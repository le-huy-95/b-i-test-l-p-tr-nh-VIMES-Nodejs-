/**
 * ROUTES XÁC THỰC (/api/v1/auth)
 * -------------------------------
 * Đăng ký, OTP, đăng nhập (email/Google), refresh token, logout, thiết bị.
 * Có rate-limit riêng cho login/OTP/register. Một số route tenant được mount tại đây.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware, requirePlatformAdmin } from '../../middlewares/auth';
import { asyncHandler } from '../../middlewares/errorHandler';
import { authController } from './auth.controller';
import { tenantController } from '../tenant/tenant.controller';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts, try again later' } },
});

const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many OTP requests, try again later' } },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many registration attempts' } },
});

router.post('/register', registerLimiter, asyncHandler(authController.register));
router.post('/verify-otp', otpLimiter, asyncHandler(authController.verifyOtp));
router.post('/resend-otp', otpLimiter, asyncHandler(authController.resendOtp));
router.post('/forgot-password', otpLimiter, asyncHandler(authController.forgotPassword));
router.post('/reset-password', otpLimiter, asyncHandler(authController.resetPassword));
router.post('/login', loginLimiter, asyncHandler(authController.login));
router.post('/login/google', loginLimiter, asyncHandler(authController.loginWithGoogle));
router.post('/refresh', asyncHandler(authController.refresh));
router.post('/logout', asyncHandler(authController.logout));
router.get('/me', authMiddleware, asyncHandler(authController.me));
router.post('/register-device', authMiddleware, asyncHandler(authController.registerDevice));
router.post('/tenants', authMiddleware, asyncHandler(tenantController.createTenant));
router.post('/invitations/accept', authMiddleware, asyncHandler(tenantController.acceptInvite));
router.post('/invitations/decline', authMiddleware, asyncHandler(tenantController.declineInvite));
router.post(
  '/platform/tenants',
  authMiddleware,
  requirePlatformAdmin,
  asyncHandler(tenantController.platformCreateTenant),
);
router.patch(
  '/platform/tenants/:id',
  authMiddleware,
  requirePlatformAdmin,
  asyncHandler(tenantController.platformPatchTenant),
);

export default router;
