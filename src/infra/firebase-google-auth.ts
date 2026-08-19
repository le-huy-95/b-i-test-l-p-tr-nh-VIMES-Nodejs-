import { isFirebaseConfigured, verifyGoogleIdToken } from '../config/firebase';
import type { GoogleTokenVerifier, GoogleVerifiedId } from '../modules/auth/google-auth.port';

export class FirebaseGoogleAuth implements GoogleTokenVerifier {
  isConfigured() {
    return isFirebaseConfigured();
  }

  async verifyIdToken(idToken: string): Promise<GoogleVerifiedId> {
    return verifyGoogleIdToken(idToken);
  }
}

export const googleAuth = new FirebaseGoogleAuth();
