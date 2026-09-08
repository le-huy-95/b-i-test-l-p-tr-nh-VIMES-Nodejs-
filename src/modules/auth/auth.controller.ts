/**
 * CONTROLLER XÁC THỰC
 * -------------------
 * Nhận HTTP request, gọi authService, trả JSON chuẩn { success, data }.
 * Không chứa logic nghiệp vụ — chỉ điều phối request/response.
 */
import { Request, Response } from 'express';
import { authService } from './auth.service';

export class AuthController {
  register = async (req: Request, res: Response) => {
    const data = await authService.register(req.body);
    res.status(201).json({ success: true, data });
  };

  verifyOtp = async (req: Request, res: Response) => {
    const data = await authService.verifyOtp(req.body);
    res.json({ success: true, data });
  };

  resendOtp = async (req: Request, res: Response) => {
    const data = await authService.resendOtp(req.body);
    res.json({ success: true, data });
  };

  forgotPassword = async (req: Request, res: Response) => {
    const data = await authService.forgotPassword(req.body);
    res.json({ success: true, data });
  };

  resetPassword = async (req: Request, res: Response) => {
    const data = await authService.resetPassword(req.body);
    res.json({ success: true, data });
  };

  login = async (req: Request, res: Response) => {
    const data = await authService.login(req.body);
    res.json({ success: true, data });
  };

  loginWithGoogle = async (req: Request, res: Response) => {
    const data = await authService.loginWithGoogle(req.body);
    res.json({ success: true, data });
  };

  refresh = async (req: Request, res: Response) => {
    const data = await authService.refresh(req.body);
    res.json({ success: true, data });
  };

  logout = async (req: Request, res: Response) => {
    const data = await authService.logout(req.body);
    res.json({ success: true, data });
  };

  me = async (req: Request, res: Response) => {
    const data = await authService.me(req.user!.id);
    res.json({ success: true, data });
  };

  registerDevice = async (req: Request, res: Response) => {
    const { device, isUpdate } = await authService.registerDevice(req.user!.id, req.body);
    res.json({
      success: true,
      data: device,
      message: isUpdate ? 'Device updated' : 'Device registered',
    });
  };
}

export const authController = new AuthController();
