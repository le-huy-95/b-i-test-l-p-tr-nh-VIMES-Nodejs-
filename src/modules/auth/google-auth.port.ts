/**
 * PORT XÁC THỰC GOOGLE
 * --------------------
 * Interface verify Google ID Token (Firebase Admin).
 * Implementation: infra/firebase-google-auth.ts
 */
export interface GoogleVerifiedId {
  uid: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
}

export interface GoogleTokenVerifier {
  isConfigured(): boolean;
  verifyIdToken(idToken: string): Promise<GoogleVerifiedId>;
}
