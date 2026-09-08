/**
 * Lớp facade re-export các type và enum Prisma từ thư mục generated.
 *
 * Thay vì import trực tiếp từ `src/generated/prisma` ở khắp codebase,
 * module này tập trung export PrismaClient, Prisma namespace và các enum
 * domain (ReceiptType, TenantRole, DocumentType, ...) để dễ bảo trì và
 * tránh phụ thuộc sâu vào đường dẫn generated.
 */
export {
  PrismaClient,
  Prisma,
  ReceiptType,
  TenantRole,
  LedgerTxnType,
  IdempotencyStatus,
  DocumentType,
  WorkflowStepStatus,
  WorkflowDocumentStatus,
  NotificationType,
  NotificationTargetType,
  ContactRelationType,
} from "../generated/prisma";
