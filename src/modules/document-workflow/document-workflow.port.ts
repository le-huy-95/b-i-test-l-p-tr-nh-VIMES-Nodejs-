import type { TenantRole } from '../../infra/prisma-types';

export type DocumentType = 'stock_issue' | 'stock_receipt' | 'stock_opening';
export type WorkflowDocumentStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'cancelled' | 'completed';
export type WorkflowStepStatus = 'pending' | 'approved' | 'rejected' | 'signed_by_proxy' | 'skipped' | 'cancelled';
export type WorkflowAction = 'submit' | 'approve' | 'reject' | 'proxy_sign' | 'skip' | 'cancel' | 'complete' | 'return';

export interface WorkflowActor {
  userId: string;
  role?: TenantRole;
  name?: string | null;
  email?: string | null;
}

export interface WorkflowActionInput {
  action: WorkflowAction;
  stepId?: string;
  note?: string;
  proxySignerId?: string | null;
  authorizationIds?: string[];
}

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
