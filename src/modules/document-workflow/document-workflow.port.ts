/**
 * Định nghĩa kiểu dữ liệu và hợp đồng (contract) cho module quy trình duyệt chứng từ.
 *
 * File này tập trung các union type trạng thái, hành động workflow, cấu trúc bước duyệt
 * và DTO kết quả trả về cho API — không chứa logic nghiệp vụ.
 */
import type { TenantRole } from '../../infra/prisma-types';

// --- Loại chứng từ và trạng thái workflow ---
export type DocumentType = 'stock_issue' | 'stock_receipt' | 'stock_opening';
export type WorkflowDocumentStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'cancelled' | 'completed';
export type WorkflowStepStatus = 'pending' | 'approved' | 'rejected' | 'signed_by_proxy' | 'skipped' | 'cancelled';
export type WorkflowAction = 'submit' | 'approve' | 'reject' | 'proxy_sign' | 'skip' | 'cancel' | 'complete' | 'return';

// --- Người thực hiện hành động trong workflow ---
export interface WorkflowActor {
  userId: string;
  role?: TenantRole;
  name?: string | null;
  email?: string | null;
}

// --- Đầu vào khi gọi API thực hiện hành động ---
export interface WorkflowActionInput {
  action: WorkflowAction;
  stepId?: string;
  note?: string;
  proxySignerId?: string | null;
  authorizationIds?: string[];
}

// --- Mẫu bước và template quy trình ---
export interface WorkflowStepTemplate {
  stepCode: string;
  stepName: string;
  sequence: number;
  requiredRole?: TenantRole;
  optional?: boolean;
}

export interface WorkflowTemplate {
  documentType: DocumentType;
  steps: WorkflowStepTemplate[];
}

// --- Kết quả trả về cho từng bước và toàn bộ workflow ---
export interface WorkflowStepResult {
  id: string;
  stepCode: string;
  stepName: string;
  sequence: number;
  status: WorkflowStepStatus;
  requiredSignerId?: string | null;
  assignedApproverId?: string | null;
  actualSignerId?: string | null;
  authorizedSignerId?: string | null;
  note?: string | null;
  actionAt?: Date | null;
}

export interface WorkflowDocumentResult {
  id: string;
  documentType: DocumentType;
  documentId: string;
  status: WorkflowDocumentStatus;
  currentStepCode?: string | null;
  currentStepStatus?: WorkflowStepStatus | null;
  currentStepUpdatedAt?: Date | null;
  lastActionById?: string | null;
  lastActionAt?: Date | null;
  steps: WorkflowStepResult[];
}

// --- Danh sách hành động khả dụng cho người dùng hiện tại ---
export interface WorkflowAvailableActionsResult {
  documentId: string;
  documentType: DocumentType;
  status: WorkflowDocumentStatus;
  currentStepId?: string | null;
  currentStepCode?: string | null;
  currentStepName?: string | null;
  currentStepAssignedApproverId?: string | null;
  actions: WorkflowAction[];
}
