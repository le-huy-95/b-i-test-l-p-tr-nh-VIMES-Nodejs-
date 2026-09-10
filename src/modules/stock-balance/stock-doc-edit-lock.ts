/**
 * Rule sửa phiếu sau create (draft + workflow in_review):
 * chỉ người tạo, và chưa có bước sau creator đã duyệt / ký thay.
 */
import type { PrismaClient } from "../../infra/prisma-types";
import { AppError } from "../../utils/app-error";
import type { DocumentType } from "../document-workflow/document-workflow.port";

export async function assertStockDocEditableByCreator(
  db: PrismaClient,
  tenantId: string,
  documentType: DocumentType,
  documentId: string,
  doc: { status: string; createdById: string },
  actorUserId: string,
): Promise<void> {
  if (doc.status !== "draft") {
    throw new AppError(
      "INVALID_STATUS_TRANSITION",
      409,
      "Only draft documents can be updated",
    );
  }
  if (doc.createdById !== actorUserId) {
    throw new AppError(
      "FORBIDDEN",
      403,
      "Only the document creator can update this document",
    );
  }

  const workflow = await db.documentWorkflow.findFirst({
    where: { tenantId, documentType, documentId },
    include: { steps: true },
  });
  if (!workflow) return;

  const locked = workflow.steps.some(
    (s) =>
      s.stepCode !== "creator" &&
      (s.status === "approved" || s.status === "signed_by_proxy"),
  );
  if (locked) {
    throw new AppError(
      "INVALID_STATUS_TRANSITION",
      409,
      "Document is locked after an approver step was completed",
    );
  }
}
