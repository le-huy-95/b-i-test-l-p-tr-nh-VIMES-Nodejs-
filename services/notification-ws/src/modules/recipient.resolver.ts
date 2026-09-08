/**
 * Giải policy người nhận thành danh sách userId.
 *
 * Kafka event không gửi sẵn list user (trừ explicit_users),
 * mà gửi RecipientPolicy; service này query DB theo tenant.
 */
import type { PrismaClient, TenantRole } from '../../../../src/infra/prisma-types';
import type { RecipientPolicy } from '../../../../src/shared/notifications/recipient-policy';

export class RecipientResolver {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Map policy → unique userId[].
   *
   * - explicit_users: dùng đúng list trong event (dedupe)
   * - source_creator: người tạo chứng từ / nguồn sự kiện
   * - tenant_roles: mọi user active trong tenant có role thuộc policy.roles
   * - type lạ: [] (không gửi ai)
   */
  async resolve(tenantId: string, policy: RecipientPolicy): Promise<string[]> {
    switch (policy.type) {
      case 'explicit_users':
        // Set để loại userId trùng trong payload
        return [...new Set(policy.userIds)];
      case 'source_creator':
        return [policy.createdByUserId];
      case 'tenant_roles': {
        const rows = await this.db.userTenant.findMany({
          where: {
            tenantId,
            isActive: true,
            role: { in: policy.roles as TenantRole[] },
          },
          select: { userId: true },
        });
        return [...new Set(rows.map((r) => r.userId))];
      }
      default:
        return [];
    }
  }
}
