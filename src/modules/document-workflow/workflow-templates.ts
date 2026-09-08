/**
 * MẪU WORKFLOW THEO LOẠI CHỨNG TỪ
 * ---------------------------------
 * Định nghĩa các bước duyệt mặc định cho phiếu nhập/xuất/tồn đầu kỳ.
 */
import type { TenantRole } from "../../infra/prisma-types";
import type {
  DocumentType,
  WorkflowStepTemplate,
  WorkflowTemplate,
} from "./document-workflow.port";

const ISSUE_RECEIPT_TEMPLATE: Omit<WorkflowStepTemplate, "sequence">[] = [
  {
    stepCode: "creator",
    stepName: "Người lập phiếu",
    requiredRole: "warehouse_keeper",
  },
  {
    stepCode: "warehouse",
    stepName: "Thủ kho",
    requiredRole: "warehouse_keeper",
  },
  {
    stepCode: "chief_accountant",
    stepName: "Kế toán trưởng",
    requiredRole: "accountant",
  },
];

const OPENING_TEMPLATE: Omit<WorkflowStepTemplate, "sequence">[] = [
  {
    stepCode: "creator",
    stepName: "Người lập phiếu",
    requiredRole: "warehouse_keeper",
  },
  {
    stepCode: "warehouse",
    stepName: "Thủ kho",
    requiredRole: "warehouse_keeper",
  },
  {
    stepCode: "chief_accountant",
    stepName: "Kế toán trưởng",
    requiredRole: "accountant",
  },
  {
    stepCode: "admin",
    stepName: "Admin doanh nghiệp",
    requiredRole: "admin" as TenantRole,
  },
];

const TEMPLATES: Record<DocumentType, WorkflowTemplate> = {
  stock_issue: {
    documentType: "stock_issue",
    steps: ISSUE_RECEIPT_TEMPLATE.map((s, i) => ({ ...s, sequence: i + 1 })),
  },
  stock_receipt: {
    documentType: "stock_receipt",
    steps: ISSUE_RECEIPT_TEMPLATE.map((s, i) => ({ ...s, sequence: i + 1 })),
  },
  stock_opening: {
    documentType: "stock_opening",
    steps: OPENING_TEMPLATE.map((s, i) => ({ ...s, sequence: i + 1 })),
  },
};

export function getWorkflowTemplate(
  documentType: DocumentType,
): WorkflowTemplate {
  const template = TEMPLATES[documentType];
  if (!template) {
    throw new Error(`No workflow template for document type: ${documentType}`);
  }
  return template;
}
