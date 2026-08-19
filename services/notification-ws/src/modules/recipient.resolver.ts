import type { PrismaClient, TenantRole } from '../../../../src/infra/prisma-types';
import type { RecipientPolicy } from '../../../../src/shared/notifications/recipient-policy';

export class RecipientResolver {
  constructor(private readonly db: PrismaClient) {}

  async resolve(tenantId: string, policy: RecipientPolicy): Promise<string[]> {
    switch (policy.type) {
      case 'explicit_users':
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
