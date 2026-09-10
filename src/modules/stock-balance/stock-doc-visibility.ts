/**
 * Phạm vi hiển thị phiếu kho (list/detail).
 * admin / warehouse_keeper / accountant → toàn tổ chức;
 * role khác → chỉ phiếu liên quan (tạo / duyệt / được gán trên workflow).
 */
import type {
  DocumentType,
  PrismaClient,
  TenantRole,
} from "../../infra/prisma-types";

export const STOCK_DOC_FULL_ACCESS_ROLES: TenantRole[] = [
  "admin",
  "warehouse_keeper",
  "accountant",
];

export type StockDocVisibilityScope = "organization" | "related_documents";

export type StockDocVisibilityActor = {
  userId: string;
  role: TenantRole;
};

export function resolveStockDocVisibilityScope(
  role: TenantRole,
): StockDocVisibilityScope {
  return STOCK_DOC_FULL_ACCESS_ROLES.includes(role)
    ? "organization"
    : "related_documents";
}

export function stockDocListCacheVisibilityKey(
  scope: StockDocVisibilityScope,
  userId: string,
): string {
  return scope === "organization" ? "org" : `user:${userId}`;
}

export function buildRelatedDocumentWhere(
  userId: string,
  relatedDocumentIds: string[],
) {
  return {
    OR: [
      { createdById: userId },
      { approvedById: userId },
      ...(relatedDocumentIds.length > 0
        ? [{ id: { in: relatedDocumentIds } }]
        : []),
    ],
  };
}

/**
 * Filter Prisma cho danh sách workflow: chỉ phiếu có bước liên quan user
 * (người lập / được gán duyệt / đã ký).
 */
export function buildRelatedWorkflowWhere(userId: string) {
  return {
    steps: {
      some: {
        OR: [
          { assignedApproverId: userId },
          { requiredSignerId: userId },
          { actualSignerId: userId },
        ],
      },
    },
  };
}

export async function loadWorkflowRelatedDocumentIds(
  db: PrismaClient,
  tenantId: string,
  documentType: DocumentType,
  userId: string,
): Promise<string[]> {
  const rows = await db.documentWorkflowStep.findMany({
    where: {
      tenantId,
      documentType,
      OR: [
        { assignedApproverId: userId },
        { requiredSignerId: userId },
        { actualSignerId: userId },
      ],
    },
    select: { documentId: true },
    distinct: ["documentId"],
  });
  return rows.map((row) => row.documentId);
}

export async function buildStockDocumentVisibilityWhere(
  db: PrismaClient,
  tenantId: string,
  documentType: DocumentType,
  actor: StockDocVisibilityActor,
) {
  const scope = resolveStockDocVisibilityScope(actor.role);
  if (scope === "organization") return {};

  const relatedIds = await loadWorkflowRelatedDocumentIds(
    db,
    tenantId,
    documentType,
    actor.userId,
  );
  return buildRelatedDocumentWhere(actor.userId, relatedIds);
}
