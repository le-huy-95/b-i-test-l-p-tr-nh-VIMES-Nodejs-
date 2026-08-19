import type { Prisma } from '../../infra/prisma-types';
import type { TenantRole } from '../../infra/prisma-types';
import type { DocumentType, WorkflowActor, WorkflowDocumentStatus } from './document-workflow.port';

export interface DocumentInfo {
  id: string;
  code: string;
  createdById: string;
  currentStatus: string;
}

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

export interface DocumentAdapterFactory {
  getAdapter(documentType: DocumentType): DocumentAdapterPort;
}
