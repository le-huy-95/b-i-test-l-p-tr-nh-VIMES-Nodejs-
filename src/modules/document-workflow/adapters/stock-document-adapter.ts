/**
 * ADAPTER CHỨNG TỪ KHO CHO WORKFLOW
 * ---------------------------------
 * Cầu nối workflow engine ↔ stock receipt/issue/opening services.
 * Khi bước cuối approved → gọi complete; rejected → rollback trạng thái.
 */
import type { Prisma } from "../../../infra/prisma-types";
import type { TenantRole } from "../../../infra/prisma-types";
import type {
  DocumentInfo,
  DocumentAdapterPort,
} from "../document-adapter.port";
import type {
  DocumentType,
  WorkflowActor,
  WorkflowDocumentStatus,
} from "../document-workflow.port";
import { stockIssueService } from "../../stock-issue/stock-issue.service";
import { stockReceiptService } from "../../stock-receipt/stock-receipt.service";
import { stockOpeningService } from "../../stock-opening/stock-opening.service";
import type { StockDocActor } from "../../../shared/notifications/stock-doc-notify";

function toStockDocActor(actor: WorkflowActor): StockDocActor {
  return { userId: actor.userId, name: actor.name, email: actor.email };
}

// Bước "creator" (Người lập phiếu) luôn do người tạo phiếu đảm nhận.
// Các bước còn lại phải được chọn người duyệt ngay khi tạo phiếu; backend chỉ dùng
// người được client truyền lên, và fallback về người tạo phiếu nếu client không gửi.
async function resolveDefaultSigner(
  stepCode: string,
  actor: WorkflowActor,
  assignedApproverId?: string | null,
): Promise<{
  requiredSignerId: string | null;
  assignedApproverId: string | null;
}> {
  if (stepCode === "creator") {
    return { requiredSignerId: actor.userId, assignedApproverId: actor.userId };
  }

  const approverId = assignedApproverId ?? actor.userId;
  return { requiredSignerId: approverId, assignedApproverId: approverId };
}

export class StockIssueDocumentAdapter implements DocumentAdapterPort {
  async getDocumentInfo(
    tenantId: string,
    documentId: string,
    trx: Prisma.TransactionClient,
  ): Promise<DocumentInfo | null> {
    const doc = await trx.stockIssue.findFirst({
      where: { id: documentId, tenantId },
      select: { id: true, code: true, createdById: true, status: true },
    });
    if (!doc) return null;
    return {
      id: doc.id,
      code: doc.code,
      createdById: doc.createdById,
      currentStatus: doc.status,
    };
  }

  async onStatusChanged(
    tenantId: string,
    documentId: string,
    _oldStatus: WorkflowDocumentStatus,
    newStatus: WorkflowDocumentStatus,
    actor: WorkflowActor,
    _trx: Prisma.TransactionClient,
  ): Promise<void> {
    const stockActor = toStockDocActor(actor);
    switch (newStatus) {
      case "in_review":
        // Legacy workflow submit: đưa phiếu sang pending_approval (+ reserve).
        await stockIssueService.markPendingApproval(
          tenantId,
          documentId,
          stockActor,
          _trx,
        );
        break;
      case "rejected":
        await stockIssueService.reject(
          tenantId,
          documentId,
          "Rejected by workflow",
          stockActor,
        );
        break;
      case "cancelled":
        await stockIssueService.cancel(tenantId, documentId, stockActor);
        break;
      case "approved":
        // Nếu reserve soft-fail → out_of_stock, approve() giữ nguyên (không overwrite).
        await stockIssueService.approve(tenantId, documentId, stockActor);
        break;
      default:
        break;
    }
  }

  async onEnteredPendingApproval(
    tenantId: string,
    documentId: string,
    actor: WorkflowActor,
    trx: Prisma.TransactionClient,
  ): Promise<void> {
    await stockIssueService.markPendingApproval(
      tenantId,
      documentId,
      toStockDocActor(actor),
      trx,
    );
  }

  async onComplete(
    tenantId: string,
    documentId: string,
    actor: WorkflowActor,
    _trx: Prisma.TransactionClient,
  ): Promise<void> {
    await stockIssueService.completeNow(
      tenantId,
      documentId,
      toStockDocActor(actor),
    );
  }

  async resolveInitialSigner(
    _tenantId: string,
    _documentId: string,
    stepCode: string,
    _requiredRole: TenantRole | null,
    actor: WorkflowActor,
    _trx: Prisma.TransactionClient,
    assignedApproverId?: string | null,
  ): Promise<{
    requiredSignerId: string | null;
    assignedApproverId: string | null;
  }> {
    return resolveDefaultSigner(stepCode, actor, assignedApproverId);
  }
}

export class StockReceiptDocumentAdapter implements DocumentAdapterPort {
  async getDocumentInfo(
    tenantId: string,
    documentId: string,
    trx: Prisma.TransactionClient,
  ): Promise<DocumentInfo | null> {
    const doc = await trx.stockReceipt.findFirst({
      where: { id: documentId, tenantId },
      select: { id: true, code: true, createdById: true, status: true },
    });
    if (!doc) return null;
    return {
      id: doc.id,
      code: doc.code,
      createdById: doc.createdById,
      currentStatus: doc.status,
    };
  }

  async onStatusChanged(
    tenantId: string,
    documentId: string,
    _oldStatus: WorkflowDocumentStatus,
    newStatus: WorkflowDocumentStatus,
    actor: WorkflowActor,
    _trx: Prisma.TransactionClient,
  ): Promise<void> {
    const stockActor = toStockDocActor(actor);
    switch (newStatus) {
      case "in_review":
        await stockReceiptService.markPendingApproval(
          tenantId,
          documentId,
          stockActor,
        );
        break;
      case "rejected":
        await stockReceiptService.reject(
          tenantId,
          documentId,
          "Rejected by workflow",
          stockActor,
        );
        break;
      case "cancelled":
        await stockReceiptService.cancel(tenantId, documentId, stockActor);
        break;
      case "approved":
        await stockReceiptService.approve(tenantId, documentId, stockActor);
        break;
      default:
        break;
    }
  }

  async onEnteredPendingApproval(
    tenantId: string,
    documentId: string,
    actor: WorkflowActor,
    _trx: Prisma.TransactionClient,
  ): Promise<void> {
    await stockReceiptService.markPendingApproval(
      tenantId,
      documentId,
      toStockDocActor(actor),
    );
  }

  async onComplete(
    tenantId: string,
    documentId: string,
    actor: WorkflowActor,
    _trx: Prisma.TransactionClient,
  ): Promise<void> {
    await stockReceiptService.completeNow(
      tenantId,
      documentId,
      toStockDocActor(actor),
    );
  }

  async resolveInitialSigner(
    _tenantId: string,
    _documentId: string,
    stepCode: string,
    _requiredRole: TenantRole | null,
    actor: WorkflowActor,
    _trx: Prisma.TransactionClient,
    assignedApproverId?: string | null,
  ): Promise<{
    requiredSignerId: string | null;
    assignedApproverId: string | null;
  }> {
    return resolveDefaultSigner(stepCode, actor, assignedApproverId);
  }
}

export class StockOpeningDocumentAdapter implements DocumentAdapterPort {
  async getDocumentInfo(
    tenantId: string,
    documentId: string,
    trx: Prisma.TransactionClient,
  ): Promise<DocumentInfo | null> {
    const doc = await trx.stockOpeningBalance.findFirst({
      where: { id: documentId, tenantId },
      select: { id: true, code: true, createdById: true, status: true },
    });
    if (!doc) return null;
    return {
      id: doc.id,
      code: doc.code,
      createdById: doc.createdById,
      currentStatus: doc.status,
    };
  }

  async onStatusChanged(
    tenantId: string,
    documentId: string,
    _oldStatus: WorkflowDocumentStatus,
    newStatus: WorkflowDocumentStatus,
    actor: WorkflowActor,
    _trx: Prisma.TransactionClient,
  ): Promise<void> {
    if (newStatus === "in_review") {
      await stockOpeningService.markPendingApproval(
        tenantId,
        documentId,
        toStockDocActor(actor),
      );
    }
  }

  async onEnteredPendingApproval(
    tenantId: string,
    documentId: string,
    actor: WorkflowActor,
    _trx: Prisma.TransactionClient,
  ): Promise<void> {
    await stockOpeningService.markPendingApproval(
      tenantId,
      documentId,
      toStockDocActor(actor),
    );
  }

  async onComplete(
    tenantId: string,
    documentId: string,
    actor: WorkflowActor,
    _trx: Prisma.TransactionClient,
  ): Promise<void> {
    await stockOpeningService.post(tenantId, documentId, actor.userId);
  }

  async resolveInitialSigner(
    _tenantId: string,
    _documentId: string,
    stepCode: string,
    _requiredRole: TenantRole | null,
    actor: WorkflowActor,
    _trx: Prisma.TransactionClient,
    assignedApproverId?: string | null,
  ): Promise<{
    requiredSignerId: string | null;
    assignedApproverId: string | null;
  }> {
    return resolveDefaultSigner(stepCode, actor, assignedApproverId);
  }
}

export class DocumentAdapterFactoryImpl {
  private static adapters: Partial<Record<DocumentType, DocumentAdapterPort>> =
    {};

  static register(
    documentType: DocumentType,
    adapter: DocumentAdapterPort,
  ): void {
    DocumentAdapterFactoryImpl.adapters[documentType] = adapter;
  }

  static getAdapter(documentType: DocumentType): DocumentAdapterPort {
    const adapter = DocumentAdapterFactoryImpl.adapters[documentType];
    if (!adapter) {
      throw new Error(
        `No document adapter registered for type: ${documentType}`,
      );
    }
    return adapter;
  }
}

DocumentAdapterFactoryImpl.register(
  "stock_issue",
  new StockIssueDocumentAdapter(),
);
DocumentAdapterFactoryImpl.register(
  "stock_receipt",
  new StockReceiptDocumentAdapter(),
);
DocumentAdapterFactoryImpl.register(
  "stock_opening",
  new StockOpeningDocumentAdapter(),
);

export function getDocumentAdapter(
  documentType: DocumentType,
): DocumentAdapterPort {
  return DocumentAdapterFactoryImpl.getAdapter(documentType);
}
