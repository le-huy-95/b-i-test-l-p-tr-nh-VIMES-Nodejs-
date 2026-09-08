/**
 * Adapter xác thực Google Sign-In qua Firebase Admin SDK.
 *
 * Triển khai port GoogleTokenVerifier: kiểm tra Firebase đã cấu hình và
 * verify ID token từ client (Flutter/web) thành GoogleVerifiedId cho auth module.
 */
import { isFirebaseConfigured, verifyGoogleIdToken } from '../config/firebase';
import type { GoogleTokenVerifier, GoogleVerifiedId } from '../modules/auth/google-auth.port';

export class FirebaseGoogleAuth implements GoogleTokenVerifier {
  /**
   * Trả true nếu env Firebase đủ để verify token Google.
   */
  isConfigured() {
    return isFirebaseConfigured();
  }

  /**
   * Xác minh ID token Google/Firebase và trả claims đã chuẩn hóa.
   */
  async verifyIdToken(idToken: string): Promise<GoogleVerifiedId> {
    return verifyGoogleIdToken(idToken);
  }
}

/** Instance singleton cho luồng đăng nhập Google */
export const googleAuth = new FirebaseGoogleAuth();
