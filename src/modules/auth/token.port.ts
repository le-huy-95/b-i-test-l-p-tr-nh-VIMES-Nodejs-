/**
 * PORT TOKEN
 * ----------
 * Interface phát hành JWT access/refresh, refresh phiên, logout.
 */
export interface TokenIssuer {
  issueTokens(
    userId: string,
    tokenVersion: number,
  ): Promise<{ accessToken: string; refreshToken: string }>;
  refresh(input: unknown): Promise<{ accessToken: string; refreshToken: string }>;
  logout(input: unknown): Promise<{ success: boolean }>;
}