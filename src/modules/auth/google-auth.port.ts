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
