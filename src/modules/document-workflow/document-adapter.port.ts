/**
 * Cổng (port) adapter kết nối engine workflow với từng loại chứng từ cụ thể.
 *
 * Mỗi loại chứng từ (phiếu xuất, phiếu nhập, tồn kho đầu kỳ...) triển khai DocumentAdapterPort
 * để đọc thông tin chứng từ, đồng bộ trạng thái khi workflow thay đổi, hoàn tất nghiệp vụ
 * và xác định người ký ban đầu cho từng bước duyệt.
 */
import type { Prisma } from '../../infra/prisma-types';
import type { TenantRole } from '../../infra/prisma-types';
import type { DocumentType, WorkflowActor, WorkflowDocumentStatus } from './document-workflow.port';

// --- Thông tin tóm tắt chứng từ cần cho workflow ---
export interface DocumentInfo {
  id: string;
  code: string;
  createdById: string;
  currentStatus: string;
}

// --- Hợp đồng adapter cho từng loại chứng từ ---
export interface DocumentAdapterPort {
  getDocumentInfo(
    tenantId: string,
    documentId: string,
    trx: Prisma.TransactionClient,
  ): Promise<DocumentInfo | null>;

  onStatusChanged(
    tenantId: string,
    documentId: string,
    oldStatus: WorkflowDocumentStatus,
    newStatus: WorkflowDocumentStatus,
    actor: WorkflowActor,
    trx: Prisma.TransactionClient,
  ): Promise<void>;

  /** Lần duyệt đầu tiên sau bước creator → phiếu draft → pending_approval */
  onEnteredPendingApproval(
    tenantId: string,
    documentId: string,
    actor: WorkflowActor,
    trx: Prisma.TransactionClient,
  ): Promise<void>;

  /**
   * Hook trước khi ghi nhận bước approve/proxy_sign.
   * Phiếu xuất: kiểm tra tồn; hết hàng → set out_of_stock và ném lỗi (chặn duyệt).
   */
  beforeApprove?(
    tenantId: string,
    documentId: string,
    actor: WorkflowActor,
  ): Promise<void>;

  onComplete(
    tenantId: string,
    documentId: string,
    actor: WorkflowActor,
    trx: Prisma.TransactionClient,
  ): Promise<void>;

  resolveInitialSigner(
    tenantId: string,
    documentId: string,
    stepCode: string,
    requiredRole: TenantRole | null,
    actor: WorkflowActor,
    trx: Prisma.TransactionClient,
    assignedApproverId?: string | null,
  ): Promise<{ requiredSignerId: string | null; assignedApproverId: string | null }>;
}

// --- Factory tra cứu adapter theo loại chứng từ ---
export interface DocumentAdapterFactory {
  getAdapter(documentType: DocumentType): DocumentAdapterPort;
}
