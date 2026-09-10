/**
 * DỊCH VỤ WORKFLOW PHÊ DUYỆT CHỨNG TỪ
 * ------------------------------------
 * Khởi tạo luồng duyệt, approve/reject từng bước, delegate, hoàn tất.
 * Liên kết với stock-document-adapter để đổi trạng thái phiếu kho.
 */
import type { PrismaClient, Prisma } from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import { AppError } from "../../utils/app-error";
import type { DocumentAdapterPort } from "./document-adapter.port";
import type {
  DocumentType,
  WorkflowAction,
  WorkflowActionInput,
  WorkflowActor,
  WorkflowAvailableActionsResult,
  WorkflowDocumentResult,
  WorkflowDocumentStatus,
  WorkflowStepStatus,
  WorkflowStepTemplate,
} from "./document-workflow.port";
import { getWorkflowTemplate } from "./workflow-templates";
import {
  assertActionAllowed,
  assertCanAssignStep,
  assertStepPending,
  computeDocumentStatus,
} from "./workflow-state-machine";
import { cacheInvalidationService } from "../../infra/cache-invalidation";
import {
  buildRelatedWorkflowWhere,
  resolveStockDocVisibilityScope,
  type StockDocVisibilityActor,
} from "../stock-balance/stock-doc-visibility";

function assertActorAssignedToStep(
  step: { assignedApproverId?: string | null },
  actor: WorkflowActor,
): void {
  if (step.assignedApproverId && step.assignedApproverId !== actor.userId) {
    throw new AppError(
      "STEP_NOT_ASSIGNED",
      403,
      "You are not assigned to approve this step",
    );
  }
}

export class DocumentWorkflowService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** Khởi tạo luồng duyệt mới từ template — tạo các bước và gán người duyệt */
  async initWorkflow(
    tenantId: string,
    documentType: DocumentType,
    documentId: string,
    actor: WorkflowActor,
    adapter: DocumentAdapterPort,
    assignedApproverIds: string[] = [],
  ): Promise<WorkflowDocumentResult> {
    const existing = await this.db.documentWorkflow.findFirst({
      where: { tenantId, documentType, documentId },
    });
    if (existing) {
      throw new AppError(
        "WORKFLOW_EXISTS",
        409,
        "Workflow already exists for this document",
      );
    }

    const docInfo = await adapter.getDocumentInfo(
      tenantId,
      documentId,
      this.db,
    );
    if (!docInfo) {
      throw new AppError("DOCUMENT_NOT_FOUND", 404, "Document not found");
    }

    const template = getWorkflowTemplate(documentType);
    const now = new Date();

    if (
      template.steps.length > 1 &&
      assignedApproverIds.length < template.steps.length - 1
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        400,
        "assignedApproverIds must include an approver for each workflow step after creator",
      );
    }

    const workflow = await this.db.documentWorkflow.create({
      data: {
        tenantId,
        documentType,
        documentId,
        status: "draft",
        currentStepCode: template.steps[0]?.stepCode ?? null,
        currentStepStatus: template.steps[0] ? "pending" : null,
        currentStepUpdatedAt: now,
        lastActionById: actor.userId,
        lastActionAt: now,
      },
    });

    const stepsData: Array<{
      tenantId: string;
      workflowId: string;
      documentType: DocumentType;
      documentId: string;
      stepCode: string;
      stepName: string;
      sequence: number;
      requiredRole: WorkflowStepTemplate["requiredRole"] | null;
      requiredSignerId: string | null;
      assignedApproverId: string | null;
      status: WorkflowStepStatus;
    }> = [];
    for (const step of template.steps) {
      const stepAssignee =
        step.stepCode === "creator"
          ? null
          : (assignedApproverIds[step.sequence - 2] ?? null);
      const { requiredSignerId, assignedApproverId } =
        await adapter.resolveInitialSigner(
          tenantId,
          documentId,
          step.stepCode,
          step.requiredRole ?? null,
          actor,
          this.db,
          stepAssignee,
        );

      stepsData.push({
        tenantId,
        workflowId: workflow.id,
        documentType,
        documentId,
        stepCode: step.stepCode,
        stepName: step.stepName,
        sequence: step.sequence,
        requiredRole: step.requiredRole ?? null,
        requiredSignerId,
        assignedApproverId,
        status: "pending" as WorkflowStepStatus,
      });
    }

    await this.db.documentWorkflowStep.createMany({ data: stepsData });

    await this.appendHistory(
      this.db,
      tenantId,
      workflow.id,
      documentType,
      documentId,
      null,
      null,
      "draft",
      actor,
      "Tạo Phiếu",
    );

    return this.buildResult(workflow);
  }

  /**
   * Sau create: duyệt bước creator + workflow → in_review.
   * Không gọi adapter.onStatusChanged(in_review) — phiếu giữ draft.
   */
  async startReviewOnCreate(
    tenantId: string,
    documentType: DocumentType,
    documentId: string,
    actor: WorkflowActor,
    _adapter: DocumentAdapterPort,
  ): Promise<WorkflowDocumentResult> {
    return this.db.$transaction(async (trx) => {
      const rows = await trx.$queryRaw<
        Array<{ id: string; status: string; version: number }>
      >`
        SELECT id, status, version FROM document_workflows
        WHERE id = (
          SELECT id FROM document_workflows
          WHERE tenant_id = ${tenantId}
            AND document_type = ${documentType}::"DocumentType"
            AND document_id = ${documentId}
          LIMIT 1
        )
        FOR UPDATE
      `;
      const locked = rows[0];
      if (!locked) {
        throw new AppError("WORKFLOW_NOT_FOUND", 404, "Workflow not found");
      }

      const workflow = await trx.documentWorkflow.findFirst({
        where: { id: locked.id, tenantId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (!workflow) {
        throw new AppError("WORKFLOW_NOT_FOUND", 404, "Workflow not found");
      }
      if (workflow.status !== "draft") {
        throw new AppError(
          "INVALID_ACTION",
          409,
          `Cannot start review from status ${workflow.status}`,
        );
      }

      const creatorStep = workflow.steps.find((s) => s.stepCode === "creator");
      if (!creatorStep) {
        throw new AppError("STEP_NOT_FOUND", 404, "Creator step not found");
      }
      if (creatorStep.status !== "pending") {
        throw new AppError(
          "STEP_NOT_PENDING",
          409,
          "Creator step is not pending",
        );
      }

      const now = new Date();
      await trx.documentWorkflowStep.update({
        where: { id: creatorStep.id },
        data: {
          status: "approved",
          actualSignerId: actor.userId,
          note: "Auto-approved on create",
          actionAt: now,
          version: { increment: 1 },
        },
      });

      const allSteps = await trx.documentWorkflowStep.findMany({
        where: { workflowId: workflow.id },
        orderBy: { sequence: "asc" },
      });
      const nextPending = allSteps.find((s) => s.status === "pending");

      const updated = await trx.documentWorkflow.update({
        where: { id: workflow.id },
        data: {
          status: "in_review",
          currentStepCode: nextPending?.stepCode ?? null,
          currentStepStatus: nextPending ? "pending" : null,
          currentStepUpdatedAt: now,
          lastActionById: actor.userId,
          lastActionAt: now,
          version: { increment: 1 },
        },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });

      await this.appendHistory(
        trx,
        tenantId,
        workflow.id,
        documentType,
        documentId,
        creatorStep.id,
        "pending",
        "approved",
        actor,
        "Auto-approved on create",
      );
      await this.appendHistory(
        trx,
        tenantId,
        workflow.id,
        documentType,
        documentId,
        null,
        "draft",
        "in_review",
        actor,
        "Started review on create",
      );

      return this.mapWorkflowToResult(
        updated as typeof updated & { steps: Array<any> },
      );
    });
  }

  /** Lấy chi tiết workflow của 1 chứng từ (các bước + trạng thái) */
  async getWorkflow(
    tenantId: string,
    documentType: DocumentType,
    documentId: string,
  ): Promise<WorkflowDocumentResult> {
    const workflow = await this.db.documentWorkflow.findFirst({
      where: { tenantId, documentType, documentId },
      include: {
        steps: {
          orderBy: { sequence: "asc" },
        },
      },
    });

    if (!workflow) {
      throw new AppError("WORKFLOW_NOT_FOUND", 404, "Workflow not found");
    }

    return this.mapWorkflowToResult(
      workflow as typeof workflow & { steps: Array<any> },
    );
  }

  /** Danh sách workflow có phân trang, lọc theo loại chứng từ/trạng thái/người duyệt + visibility */
  async listWorkflows(
    tenantId: string,
    query: {
      documentType?: DocumentType;
      status?: WorkflowDocumentStatus;
      assignedApproverId?: string;
      warehouseId?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    actor: StockDocVisibilityActor,
  ): Promise<{
    data: WorkflowDocumentResult[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const warehouseId = query.warehouseId?.trim() || undefined;
    const search = query.search?.trim() || undefined;

    const where: Record<string, unknown> = { tenantId };
    if (query.documentType) where.documentType = query.documentType;
    if (query.status) where.status = query.status;

    const andFilters: Record<string, unknown>[] = [];
    if (query.assignedApproverId) {
      andFilters.push({
        steps: {
          some: {
            assignedApproverId: query.assignedApproverId,
            status: "pending",
          },
        },
      });
    }

    const scope = resolveStockDocVisibilityScope(actor.role);
    if (scope === "related_documents") {
      andFilters.push(buildRelatedWorkflowWhere(actor.userId));
    }

    if (andFilters.length === 1) {
      Object.assign(where, andFilters[0]);
    } else if (andFilters.length > 1) {
      where.AND = andFilters;
    }

    if (warehouseId || search) {
      const matchedIds = await this.resolveDocumentIdsByWarehouseOrSearch(
        tenantId,
        query.documentType,
        { warehouseId, search },
      );
      if (matchedIds.length === 0) {
        return {
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        };
      }
      where.documentId = { in: matchedIds };
    }

    const [workflows, total] = await Promise.all([
      this.db.documentWorkflow.findMany({
        where,
        include: { steps: { orderBy: { sequence: "asc" } } },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.documentWorkflow.count({ where }),
    ]);

    return {
      data: workflows.map((w) =>
        this.mapWorkflowToResult(w as typeof w & { steps: Array<any> }),
      ),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }

  /**
   * Resolve phiếu IDs matching warehouseId / search (code OR warehouse.name).
   * document_workflows không có code/warehouseId nên phải lookup bảng phiếu.
   */
  private async resolveDocumentIdsByWarehouseOrSearch(
    tenantId: string,
    documentType: DocumentType | undefined,
    filters: { warehouseId?: string; search?: string },
  ): Promise<string[]> {
    const types: DocumentType[] = documentType
      ? [documentType]
      : ["stock_issue", "stock_receipt", "stock_opening"];

    const docWhere: Record<string, unknown> = { tenantId };
    if (filters.warehouseId) {
      docWhere.warehouseId = filters.warehouseId;
    }
    if (filters.search) {
      docWhere.OR = [
        { code: { contains: filters.search, mode: "insensitive" } },
        {
          warehouse: {
            name: { contains: filters.search, mode: "insensitive" },
          },
        },
      ];
    }

    const idLists = await Promise.all(
      types.map(async (type) => {
        const rows = await this.findStockDocIds(type, docWhere);
        return rows.map((row) => row.id);
      }),
    );

    return [...new Set(idLists.flat())];
  }

  private async findStockDocIds(
    documentType: DocumentType,
    where: Record<string, unknown>,
  ): Promise<Array<{ id: string }>> {
    switch (documentType) {
      case "stock_issue":
        return this.db.stockIssue.findMany({
          where,
          select: { id: true },
        });
      case "stock_receipt":
        return this.db.stockReceipt.findMany({
          where,
          select: { id: true },
        });
      case "stock_opening":
        return this.db.stockOpeningBalance.findMany({
          where,
          select: { id: true },
        });
      default:
        return [];
    }
  }

  /** Thực hiện hành động duyệt: approve / reject / cancel — có optimistic lock version */
  async performAction(
    tenantId: string,
    documentType: DocumentType,
    documentId: string,
    input: WorkflowActionInput,
    actor: WorkflowActor,
    adapter: DocumentAdapterPort,
  ): Promise<WorkflowDocumentResult> {
    return this.db.$transaction(async (trx) => {
      const rows = await trx.$queryRaw<
        Array<{ id: string; status: string; version: number }>
      >`
        SELECT id, status, version FROM document_workflows
        WHERE id = (
          SELECT id FROM document_workflows
          WHERE tenant_id = ${tenantId}
            AND document_type = ${documentType}::"DocumentType"
            AND document_id = ${documentId}
          LIMIT 1
        )
        FOR UPDATE
      `;
      const locked = rows[0];
      if (!locked) {
        throw new AppError("WORKFLOW_NOT_FOUND", 404, "Workflow not found");
      }

      const workflow = await trx.documentWorkflow.findFirst({
        where: { id: locked.id, tenantId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (!workflow) {
        throw new AppError("WORKFLOW_NOT_FOUND", 404, "Workflow not found");
      }

      const currentStatus = workflow.status as WorkflowDocumentStatus;
      assertActionAllowed(currentStatus, input.action);

      if (input.action === "submit") {
        return this.handleSubmit(
          trx,
          workflow as typeof workflow & { steps: any[] },
          input,
          actor,
          adapter,
        );
      }

      if (input.action === "cancel") {
        return this.handleCancel(
          trx,
          workflow as typeof workflow & { steps: any[] },
          input,
          actor,
          adapter,
        );
      }

      if (input.action === "complete") {
        return this.handleComplete(
          trx,
          workflow as typeof workflow & { steps: any[] },
          input,
          actor,
          adapter,
        );
      }

      const step = input.stepId
        ? workflow.steps.find(
            (s: { id: string; status: WorkflowStepStatus }) =>
              s.id === input.stepId,
          )
        : workflow.steps.find(
            (s: { status: WorkflowStepStatus }) => s.status === "pending",
          );

      if (!step) {
        throw new AppError("STEP_NOT_FOUND", 404, "No pending step found");
      }

      assertStepPending(step.status as WorkflowStepStatus);
      assertActorAssignedToStep(
        step as { assignedApproverId?: string | null },
        actor,
      );

      if (input.action === "approve") {
        return this.handleStepApprove(
          trx,
          workflow as typeof workflow & { steps: any[] },
          step,
          input,
          actor,
          adapter,
        );
      }

      if (input.action === "reject") {
        return this.handleStepReject(
          trx,
          workflow as typeof workflow & { steps: any[] },
          step,
          input,
          actor,
          adapter,
        );
      }

      if (input.action === "proxy_sign") {
        return this.handleProxySign(
          trx,
          workflow as typeof workflow & { steps: any[] },
          step,
          input,
          actor,
          adapter,
        );
      }

      if (input.action === "skip") {
        return this.handleSkip(
          trx,
          workflow as typeof workflow & { steps: any[] },
          step,
          input,
          actor,
          adapter,
        );
      }

      throw new AppError(
        "INVALID_ACTION",
        400,
        `Unknown action: ${input.action}`,
      );
    });
  }

  /** Gán (hoặc đổi) người duyệt cho 1 bước đang pending */
  async assignStep(
    tenantId: string,
    _documentType: DocumentType,
    documentId: string,
    stepId: string,
    assignedApproverId: string,
  ): Promise<WorkflowDocumentResult> {
    return this.db.$transaction(async (trx) => {
      const step = await trx.documentWorkflowStep.findFirst({
        where: { id: stepId, tenantId, documentId },
      });
      if (!step) {
        throw new AppError("STEP_NOT_FOUND", 404, "Step not found");
      }
      assertCanAssignStep(step.status as WorkflowStepStatus);

      await trx.documentWorkflowStep.update({
        where: { id: stepId },
        data: { assignedApproverId },
      });

      const workflow = await trx.documentWorkflow.findFirst({
        where: { id: step.workflowId, tenantId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (!workflow) {
        throw new AppError("WORKFLOW_NOT_FOUND", 404, "Workflow not found");
      }
      return this.mapWorkflowToResult(
        workflow as typeof workflow & { steps: Array<any> },
      );
    });
  }

  /** Upload giấy ủy quyền đính kèm bước duyệt (file, số văn bản, hiệu lực...) */
  async uploadAuthorization(
    tenantId: string,
    _documentType: DocumentType,
    documentId: string,
    stepId: string,
    data: {
      uploadedById: string;
      fileUrl?: string;
      fileName?: string;
      authorizationNo?: string;
      issuedBy?: string;
      issuedAt?: Date;
      validFrom?: Date;
      validTo?: Date;
      note?: string;
    },
  ): Promise<{ id: string }> {
    const step = await this.db.documentWorkflowStep.findFirst({
      where: { id: stepId, tenantId, documentId },
    });
    if (!step) {
      throw new AppError("STEP_NOT_FOUND", 404, "Step not found");
    }

    const auth = await this.db.documentStepAuthorization.create({
      data: {
        tenantId,
        workflowId: step.workflowId,
        stepId,
        documentId,
        uploadedById: data.uploadedById,
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        authorizationNo: data.authorizationNo,
        issuedBy: data.issuedBy,
        issuedAt: data.issuedAt,
        validFrom: data.validFrom,
        validTo: data.validTo,
        note: data.note,
      },
    });
    return { id: auth.id };
  }

  /** Lịch sử chuyển trạng thái workflow — dùng hiển thị timeline trên UI */
  async getTimeline(
    tenantId: string,
    documentType: DocumentType,
    documentId: string,
  ): Promise<
    Array<{
      id: string;
      fromStatus: string;
      toStatus: string;
      changedById: string;
      changedByRole?: string | null;
      note?: string | null;
      changedAt: Date;
      metadata?: unknown;
    }>
  > {
    const histories = await this.db.documentStatusHistory.findMany({
      where: { tenantId, documentType, documentId },
      orderBy: { changedAt: "asc" },
    });
    return histories.map(
      (h: {
        id: string;
        fromStatus: string;
        toStatus: string;
        changedById: string;
        changedByRole: string | null;
        note: string | null;
        changedAt: Date;
        metadata: unknown;
      }) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedById: h.changedById,
        changedByRole: h.changedByRole,
        note: h.note,
        changedAt: h.changedAt,
        metadata: h.metadata,
      }),
    );
  }

  private async handleSubmit(
    trx: Prisma.TransactionClient,
    workflow: {
      id: string;
      tenantId: string;
      documentType: DocumentType;
      documentId: string;
      status: WorkflowDocumentStatus;
      steps: Array<{ status: WorkflowStepStatus }>;
    },
    input: WorkflowActionInput,
    actor: WorkflowActor,
    adapter: DocumentAdapterPort,
  ): Promise<WorkflowDocumentResult> {
    const oldStatus = workflow.status as WorkflowDocumentStatus;
    const newStatus: WorkflowDocumentStatus = "in_review";
    const now = new Date();

    const updated = await trx.documentWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: newStatus,
        lastActionById: actor.userId,
        lastActionAt: now,
        version: { increment: 1 },
      },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });

    await this.appendHistory(
      trx,
      workflow.tenantId,
      workflow.id,
      workflow.documentType,
      workflow.documentId,
      null,
      oldStatus,
      newStatus,
      actor,
      input.note ?? "Submitted",
    );

    await adapter.onStatusChanged(
      workflow.tenantId,
      workflow.documentId,
      oldStatus,
      newStatus,
      actor,
      trx,
    );

    return this.mapWorkflowToResult(
      updated as typeof updated & { steps: Array<any> },
    );
  }

  private async handleCancel(
    trx: Prisma.TransactionClient,
    workflow: {
      id: string;
      tenantId: string;
      documentType: DocumentType;
      documentId: string;
      status: WorkflowDocumentStatus;
      steps: Array<{ status: WorkflowStepStatus }>;
    },
    input: WorkflowActionInput,
    actor: WorkflowActor,
    adapter: DocumentAdapterPort,
  ): Promise<WorkflowDocumentResult> {
    const oldStatus = workflow.status as WorkflowDocumentStatus;
    const newStatus: WorkflowDocumentStatus = "cancelled";
    const now = new Date();

    await trx.documentWorkflowStep.updateMany({
      where: { workflowId: workflow.id, status: "pending" },
      data: { status: "cancelled" },
    });

    const updated = await trx.documentWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: newStatus,
        currentStepCode: null,
        currentStepStatus: null,
        lastActionById: actor.userId,
        lastActionAt: now,
        version: { increment: 1 },
      },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });

    await this.appendHistory(
      trx,
      workflow.tenantId,
      workflow.id,
      workflow.documentType,
      workflow.documentId,
      null,
      oldStatus,
      newStatus,
      actor,
      input.note ?? "Cancelled",
    );

    await adapter.onStatusChanged(
      workflow.tenantId,
      workflow.documentId,
      oldStatus,
      newStatus,
      actor,
      trx,
    );

    return this.mapWorkflowToResult(
      updated as typeof updated & { steps: Array<any> },
    );
  }

  private async handleComplete(
    trx: Prisma.TransactionClient,
    workflow: {
      id: string;
      tenantId: string;
      documentType: DocumentType;
      documentId: string;
      status: WorkflowDocumentStatus;
      steps: Array<{ status: WorkflowStepStatus }>;
    },
    input: WorkflowActionInput,
    actor: WorkflowActor,
    adapter: DocumentAdapterPort,
  ): Promise<WorkflowDocumentResult> {
    const oldStatus = workflow.status as WorkflowDocumentStatus;
    const newStatus: WorkflowDocumentStatus = "completed";
    const now = new Date();

    const updated = await trx.documentWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: newStatus,
        currentStepCode: null,
        currentStepStatus: null,
        lastActionById: actor.userId,
        lastActionAt: now,
        version: { increment: 1 },
      },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });

    await this.appendHistory(
      trx,
      workflow.tenantId,
      workflow.id,
      workflow.documentType,
      workflow.documentId,
      null,
      oldStatus,
      newStatus,
      actor,
      input.note ?? "Completed",
    );

    await adapter.onComplete(
      workflow.tenantId,
      workflow.documentId,
      actor,
      trx,
    );

    await cacheInvalidationService.invalidateStockMutations(workflow.tenantId);

    return this.mapWorkflowToResult(
      updated as typeof updated & { steps: Array<any> },
    );
  }

  private async handleStepApprove(
    trx: Prisma.TransactionClient,
    workflow: {
      id: string;
      tenantId: string;
      documentType: DocumentType;
      documentId: string;
      status: WorkflowDocumentStatus;
      steps: Array<{
        id: string;
        stepCode: string;
        stepName: string;
        sequence: number;
        status: WorkflowStepStatus;
        requiredSignerId: string | null;
        assignedApproverId: string | null;
        actualSignerId: string | null;
        authorizedSignerId: string | null;
        note: string | null;
        actionAt: Date | null;
      }>;
    },
    step: {
      id: string;
      stepCode: string;
      stepName: string;
      sequence: number;
      status: WorkflowStepStatus;
      requiredSignerId: string | null;
      assignedApproverId: string | null;
      actualSignerId: string | null;
      authorizedSignerId: string | null;
      note: string | null;
      actionAt: Date | null;
    },
    input: WorkflowActionInput,
    actor: WorkflowActor,
    adapter: DocumentAdapterPort,
  ): Promise<WorkflowDocumentResult> {
    if (adapter.beforeApprove) {
      await adapter.beforeApprove(
        workflow.tenantId,
        workflow.documentId,
        actor,
      );
    }

    const now = new Date();

    const updatedStep = await trx.documentWorkflowStep.update({
      where: { id: step.id },
      data: {
        status: "approved",
        actualSignerId: actor.userId,
        note: input.note,
        actionAt: now,
        version: { increment: 1 },
      },
    });

    const allSteps = await trx.documentWorkflowStep.findMany({
      where: { workflowId: workflow.id },
      orderBy: { sequence: "asc" },
    });

    const oldDocStatus = workflow.status as WorkflowDocumentStatus;
    const newDocStatus = computeDocumentStatus(
      allSteps.map((s) => ({ status: s.status as WorkflowStepStatus })),
      oldDocStatus,
      "approve",
    );

    const nextPending = allSteps.find((s) => s.status === "pending");

    const updated = await trx.documentWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: newDocStatus,
        currentStepCode: nextPending?.stepCode ?? null,
        currentStepStatus: nextPending ? "pending" : null,
        currentStepUpdatedAt: now,
        lastActionById: actor.userId,
        lastActionAt: now,
        version: { increment: 1 },
      },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });

    await this.appendHistory(
      trx,
      workflow.tenantId,
      workflow.id,
      workflow.documentType,
      workflow.documentId,
      updatedStep.id,
      step.status,
      "approved",
      actor,
      input.note ?? "Step approved",
    );

    await this.maybeEnterPendingApproval(
      trx,
      workflow.tenantId,
      workflow.documentId,
      step.stepCode,
      allSteps.map((s) => ({
        stepCode: s.stepCode,
        status: s.status as WorkflowStepStatus,
      })),
      actor,
      adapter,
    );

    if (newDocStatus !== oldDocStatus) {
      await this.appendHistory(
        trx,
        workflow.tenantId,
        workflow.id,
        workflow.documentType,
        workflow.documentId,
        null,
        oldDocStatus,
        newDocStatus,
        actor,
        `Document status changed to ${newDocStatus}`,
      );
      await adapter.onStatusChanged(
        workflow.tenantId,
        workflow.documentId,
        oldDocStatus,
        newDocStatus,
        actor,
        trx,
      );
    }

    await cacheInvalidationService.invalidateStockDocuments(workflow.tenantId);

    return this.mapWorkflowToResult(
      updated as typeof updated & { steps: Array<any> },
    );
  }

  private async handleStepReject(
    trx: Prisma.TransactionClient,
    workflow: {
      id: string;
      tenantId: string;
      documentType: DocumentType;
      documentId: string;
      status: WorkflowDocumentStatus;
      steps: Array<{
        id: string;
        stepCode: string;
        stepName: string;
        sequence: number;
        status: WorkflowStepStatus;
        requiredSignerId: string | null;
        assignedApproverId: string | null;
        actualSignerId: string | null;
        authorizedSignerId: string | null;
        note: string | null;
        actionAt: Date | null;
      }>;
    },
    step: {
      id: string;
      stepCode: string;
      stepName: string;
      sequence: number;
      status: WorkflowStepStatus;
      requiredSignerId: string | null;
      assignedApproverId: string | null;
      actualSignerId: string | null;
      authorizedSignerId: string | null;
      note: string | null;
      actionAt: Date | null;
    },
    input: WorkflowActionInput,
    actor: WorkflowActor,
    adapter: DocumentAdapterPort,
  ): Promise<WorkflowDocumentResult> {
    const now = new Date();

    const updatedStep = await trx.documentWorkflowStep.update({
      where: { id: step.id },
      data: {
        status: "rejected",
        actualSignerId: actor.userId,
        note: input.note,
        actionAt: now,
        version: { increment: 1 },
      },
    });

    await trx.documentWorkflowStep.updateMany({
      where: { workflowId: workflow.id, status: "pending" },
      data: { status: "cancelled" },
    });

    const oldDocStatus = workflow.status as WorkflowDocumentStatus;
    const newDocStatus: WorkflowDocumentStatus = "rejected";

    const updated = await trx.documentWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: newDocStatus,
        currentStepCode: null,
        currentStepStatus: null,
        lastActionById: actor.userId,
        lastActionAt: now,
        version: { increment: 1 },
      },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });

    await this.appendHistory(
      trx,
      workflow.tenantId,
      workflow.id,
      workflow.documentType,
      workflow.documentId,
      updatedStep.id,
      step.status,
      "rejected",
      actor,
      input.note ?? "Step rejected",
    );

    await this.appendHistory(
      trx,
      workflow.tenantId,
      workflow.id,
      workflow.documentType,
      workflow.documentId,
      null,
      oldDocStatus,
      newDocStatus,
      actor,
      `Document rejected at step "${step.stepName}"`,
    );

    await adapter.onStatusChanged(
      workflow.tenantId,
      workflow.documentId,
      oldDocStatus,
      newDocStatus,
      actor,
      trx,
    );

    await cacheInvalidationService.invalidateStockDocuments(workflow.tenantId);

    return this.mapWorkflowToResult(
      updated as typeof updated & { steps: Array<any> },
    );
  }

  private async handleProxySign(
    trx: Prisma.TransactionClient,
    workflow: {
      id: string;
      tenantId: string;
      documentType: DocumentType;
      documentId: string;
      status: WorkflowDocumentStatus;
      steps: Array<{
        id: string;
        stepCode: string;
        stepName: string;
        sequence: number;
        status: WorkflowStepStatus;
        requiredSignerId: string | null;
        assignedApproverId: string | null;
        actualSignerId: string | null;
        authorizedSignerId: string | null;
        note: string | null;
        actionAt: Date | null;
      }>;
    },
    step: {
      id: string;
      stepCode: string;
      stepName: string;
      sequence: number;
      status: WorkflowStepStatus;
      requiredSignerId: string | null;
      assignedApproverId: string | null;
      actualSignerId: string | null;
      authorizedSignerId: string | null;
      note: string | null;
      actionAt: Date | null;
    },
    input: WorkflowActionInput,
    actor: WorkflowActor,
    adapter: DocumentAdapterPort,
  ): Promise<WorkflowDocumentResult> {
    if (!input.proxySignerId) {
      throw new AppError(
        "VALIDATION_ERROR",
        400,
        "proxySignerId is required for proxy_sign action",
      );
    }

    const authorizationIds = input.authorizationIds ?? [];
    if (authorizationIds.length === 0) {
      throw new AppError(
        "AUTHORIZATION_INVALID",
        400,
        "At least one authorization document is required for proxy signing",
      );
    }

    const authorizations = await trx.documentStepAuthorization.findMany({
      where: {
        id: { in: authorizationIds },
        stepId: step.id,
        tenantId: workflow.tenantId,
      },
    });

    if (authorizations.length !== authorizationIds.length) {
      throw new AppError(
        "AUTHORIZATION_INVALID",
        400,
        "One or more authorization documents not found",
      );
    }

    const now = new Date();
    for (const auth of authorizations) {
      if (auth.validFrom && auth.validFrom > now) {
        throw new AppError(
          "AUTHORIZATION_INVALID",
          400,
          `Authorization ${auth.authorizationNo} is not yet valid`,
        );
      }
      if (auth.validTo && auth.validTo < now) {
        throw new AppError(
          "AUTHORIZATION_INVALID",
          400,
          `Authorization ${auth.authorizationNo} has expired`,
        );
      }
      if (!auth.fileUrl) {
        throw new AppError(
          "AUTHORIZATION_INVALID",
          400,
          `Authorization ${auth.authorizationNo} has no attached file`,
        );
      }
    }

    if (adapter.beforeApprove) {
      await adapter.beforeApprove(
        workflow.tenantId,
        workflow.documentId,
        actor,
      );
    }

    const updatedStep = await trx.documentWorkflowStep.update({
      where: { id: step.id },
      data: {
        status: "signed_by_proxy",
        actualSignerId: input.proxySignerId,
        authorizedSignerId: input.proxySignerId,
        note: input.note,
        actionAt: now,
        version: { increment: 1 },
      },
    });

    const allSteps = await trx.documentWorkflowStep.findMany({
      where: { workflowId: workflow.id },
      orderBy: { sequence: "asc" },
    });

    const oldDocStatus = workflow.status as WorkflowDocumentStatus;
    const newDocStatus = computeDocumentStatus(
      allSteps.map((s) => ({ status: s.status as WorkflowStepStatus })),
      oldDocStatus,
      "proxy_sign",
    );

    const nextPending = allSteps.find((s) => s.status === "pending");

    const updated = await trx.documentWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: newDocStatus,
        currentStepCode: nextPending?.stepCode ?? null,
        currentStepStatus: nextPending ? "pending" : null,
        currentStepUpdatedAt: now,
        lastActionById: actor.userId,
        lastActionAt: now,
        version: { increment: 1 },
      },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });

    await this.appendHistory(
      trx,
      workflow.tenantId,
      workflow.id,
      workflow.documentType,
      workflow.documentId,
      updatedStep.id,
      step.status,
      "signed_by_proxy",
      actor,
      input.note ?? `Signed by proxy: ${input.proxySignerId}`,
      { proxySignerId: input.proxySignerId, authorizationIds },
    );

    await this.maybeEnterPendingApproval(
      trx,
      workflow.tenantId,
      workflow.documentId,
      step.stepCode,
      allSteps.map((s) => ({
        stepCode: s.stepCode,
        status: s.status as WorkflowStepStatus,
      })),
      actor,
      adapter,
    );

    if (newDocStatus !== oldDocStatus) {
      await this.appendHistory(
        trx,
        workflow.tenantId,
        workflow.id,
        workflow.documentType,
        workflow.documentId,
        null,
        oldDocStatus,
        newDocStatus,
        actor,
        `Document status changed to ${newDocStatus}`,
      );
      await adapter.onStatusChanged(
        workflow.tenantId,
        workflow.documentId,
        oldDocStatus,
        newDocStatus,
        actor,
        trx,
      );
    }

    await cacheInvalidationService.invalidateStockDocuments(workflow.tenantId);

    return this.mapWorkflowToResult(
      updated as typeof updated & { steps: Array<any> },
    );
  }

  /** Duyệt bước đầu sau creator → phiếu sang pending_approval (qua adapter) */
  private async maybeEnterPendingApproval(
    trx: Prisma.TransactionClient,
    tenantId: string,
    documentId: string,
    approvedStepCode: string,
    allSteps: Array<{ stepCode: string; status: WorkflowStepStatus }>,
    actor: WorkflowActor,
    adapter: DocumentAdapterPort,
  ): Promise<void> {
    if (approvedStepCode === "creator") return;

    const approvedPostCreatorCount = allSteps.filter(
      (s) =>
        Boolean(s.stepCode) &&
        s.stepCode !== "creator" &&
        (s.status === "approved" || s.status === "signed_by_proxy"),
    ).length;

    if (approvedPostCreatorCount !== 1) return;

    await adapter.onEnteredPendingApproval(
      tenantId,
      documentId,
      actor,
      trx,
    );
  }

  /** Trả về các hành động user hiện tại được phép thực hiện trên chứng từ */
  async getAvailableActions(
    tenantId: string,
    documentType: DocumentType,
    documentId: string,
    actor: WorkflowActor,
  ): Promise<WorkflowAvailableActionsResult> {
    const workflow = await this.db.documentWorkflow.findFirst({
      where: { tenantId, documentType, documentId },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    if (!workflow) {
      throw new AppError("WORKFLOW_NOT_FOUND", 404, "Workflow not found");
    }

    const currentStep =
      workflow.steps.find((step) => step.status === "pending") ?? null;
    const actions: WorkflowAction[] = [];

    switch (workflow.status as WorkflowDocumentStatus) {
      case "draft":
        actions.push("submit", "cancel");
        break;
      case "in_review":
        if (
          !currentStep ||
          !currentStep.assignedApproverId ||
          currentStep.assignedApproverId === actor.userId
        ) {
          actions.push("approve", "reject", "proxy_sign", "skip", "cancel");
        }
        break;
      case "approved":
        actions.push("complete", "cancel");
        break;
      default:
        break;
    }

    if (documentType === "stock_issue") {
      const issue = await this.db.stockIssue.findFirst({
        where: { id: documentId, tenantId },
        select: { status: true },
      });
      if (issue?.status === "out_of_stock") {
        const allowed = new Set<WorkflowAction>(["cancel", "reject"]);
        return {
          documentId,
          documentType,
          status: workflow.status as WorkflowDocumentStatus,
          currentStepId: currentStep?.id ?? null,
          currentStepCode: currentStep?.stepCode ?? null,
          currentStepName: currentStep?.stepName ?? null,
          currentStepAssignedApproverId: currentStep?.assignedApproverId ?? null,
          actions: actions.filter((a) => allowed.has(a)),
        };
      }
    }

    return {
      documentId,
      documentType,
      status: workflow.status as WorkflowDocumentStatus,
      currentStepId: currentStep?.id ?? null,
      currentStepCode: currentStep?.stepCode ?? null,
      currentStepName: currentStep?.stepName ?? null,
      currentStepAssignedApproverId: currentStep?.assignedApproverId ?? null,
      actions,
    };
  }

  private async handleSkip(
    trx: Prisma.TransactionClient,
    workflow: {
      id: string;
      tenantId: string;
      documentType: DocumentType;
      documentId: string;
      status: WorkflowDocumentStatus;
      steps: Array<{
        id: string;
        stepCode: string;
        stepName: string;
        sequence: number;
        status: WorkflowStepStatus;
        requiredSignerId: string | null;
        assignedApproverId: string | null;
        actualSignerId: string | null;
        authorizedSignerId: string | null;
        note: string | null;
        actionAt: Date | null;
      }>;
    },
    step: {
      id: string;
      stepCode: string;
      stepName: string;
      sequence: number;
      status: WorkflowStepStatus;
      requiredSignerId: string | null;
      assignedApproverId: string | null;
      actualSignerId: string | null;
      authorizedSignerId: string | null;
      note: string | null;
      actionAt: Date | null;
    },
    input: WorkflowActionInput,
    actor: WorkflowActor,
    adapter: DocumentAdapterPort,
  ): Promise<WorkflowDocumentResult> {
    const now = new Date();

    const updatedStep = await trx.documentWorkflowStep.update({
      where: { id: step.id },
      data: {
        status: "skipped",
        actualSignerId: actor.userId,
        note: input.note ?? "Skipped",
        actionAt: now,
        version: { increment: 1 },
      },
    });

    const allSteps = await trx.documentWorkflowStep.findMany({
      where: { workflowId: workflow.id },
      orderBy: { sequence: "asc" },
    });

    const oldDocStatus = workflow.status as WorkflowDocumentStatus;
    const newDocStatus = computeDocumentStatus(
      allSteps.map((s) => ({ status: s.status as WorkflowStepStatus })),
      oldDocStatus,
      "skip",
    );

    const nextPending = allSteps.find((s) => s.status === "pending");

    const updated = await trx.documentWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: newDocStatus,
        currentStepCode: nextPending?.stepCode ?? null,
        currentStepStatus: nextPending ? "pending" : null,
        currentStepUpdatedAt: now,
        lastActionById: actor.userId,
        lastActionAt: now,
        version: { increment: 1 },
      },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });

    await this.appendHistory(
      trx,
      workflow.tenantId,
      workflow.id,
      workflow.documentType,
      workflow.documentId,
      updatedStep.id,
      step.status,
      "skipped",
      actor,
      input.note ?? "Step skipped",
    );

    if (newDocStatus !== oldDocStatus) {
      await this.appendHistory(
        trx,
        workflow.tenantId,
        workflow.id,
        workflow.documentType,
        workflow.documentId,
        null,
        oldDocStatus,
        newDocStatus,
        actor,
        `Document status changed to ${newDocStatus}`,
      );
      await adapter.onStatusChanged(
        workflow.tenantId,
        workflow.documentId,
        oldDocStatus,
        newDocStatus,
        actor,
        trx,
      );
    }

    return this.mapWorkflowToResult(
      updated as typeof updated & { steps: Array<any> },
    );
  }

  private async appendHistory(
    trxOrDb: Prisma.TransactionClient | PrismaClient,
    tenantId: string,
    workflowId: string,
    documentType: DocumentType,
    documentId: string,
    stepId: string | null,
    fromStatus: string | null,
    toStatus: string,
    actor: WorkflowActor,
    note: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await trxOrDb.documentStatusHistory.create({
      data: {
        tenantId,
        workflowId,
        documentType,
        documentId,
        stepId,
        fromStatus: fromStatus ?? "",
        toStatus,
        changedById: actor.userId,
        changedByRole: actor.role ?? null,
        note,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    });
  }

  private async buildResult(workflow: {
    id: string;
    tenantId: string;
    documentType: DocumentType;
    documentId: string;
    status: WorkflowDocumentStatus;
    currentStepCode: string | null;
    currentStepStatus: WorkflowStepStatus | null;
    currentStepUpdatedAt: Date | null;
    lastActionById: string | null;
    lastActionAt: Date | null;
  }): Promise<WorkflowDocumentResult> {
    const steps = await this.db.documentWorkflowStep.findMany({
      where: { workflowId: workflow.id },
      orderBy: { sequence: "asc" },
    });
    return this.mapWorkflowToResult({ ...workflow, steps });
  }

  private mapWorkflowToResult(workflow: {
    id: string;
    tenantId: string;
    documentType: DocumentType;
    documentId: string;
    status: WorkflowDocumentStatus;
    currentStepCode: string | null;
    currentStepStatus: WorkflowStepStatus | null;
    currentStepUpdatedAt: Date | null;
    lastActionById: string | null;
    lastActionAt: Date | null;
    steps?: Array<{
      id: string;
      stepCode: string;
      stepName: string;
      sequence: number;
      status: WorkflowStepStatus;
      requiredSignerId: string | null;
      assignedApproverId: string | null;
      actualSignerId: string | null;
      authorizedSignerId: string | null;
      note: string | null;
      actionAt: Date | null;
    }>;
  }): WorkflowDocumentResult {
    const steps = (workflow.steps ?? []).map((s) => ({
      id: s.id,
      stepCode: s.stepCode,
      stepName: s.stepName,
      sequence: s.sequence,
      status: s.status as WorkflowStepStatus,
      requiredSignerId: s.requiredSignerId,
      assignedApproverId: s.assignedApproverId,
      actualSignerId: s.actualSignerId,
      authorizedSignerId: s.authorizedSignerId,
      note: s.note,
      actionAt: s.actionAt,
    }));

    return {
      id: workflow.id,
      documentType: workflow.documentType as DocumentType,
      documentId: workflow.documentId,
      status: workflow.status as WorkflowDocumentStatus,
      currentStepCode: workflow.currentStepCode,
      currentStepStatus:
        workflow.currentStepStatus as WorkflowStepStatus | null,
      currentStepUpdatedAt: workflow.currentStepUpdatedAt,
      lastActionById: workflow.lastActionById,
      lastActionAt: workflow.lastActionAt,
      steps,
    };
  }
}

export const documentWorkflowService = new DocumentWorkflowService(prisma);
