/**
 * Key Redis cho cache danh sách tổ chức (tenant) của một user.
 * Dùng chung bởi AuthService (getOrSet) và TenantService (invalidate).
 */
export function userTenantsCacheKey(userId: string): string {
  return `list:user-tenants:${userId}`;
}
