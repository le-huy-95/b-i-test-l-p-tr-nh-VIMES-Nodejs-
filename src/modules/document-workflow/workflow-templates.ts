import type { TenantRole } from '../../infra/prisma-types';
import type { DocumentType, WorkflowStepTemplate, WorkflowTemplate } from './document-workflow.port';

const FOUR_STEP_TEMPLATE: Omit<WorkflowStepTemplate, 'sequence'>[] = [
  { stepCode: 'creator', stepName: 'Người lập phiếu', requiredRole: 'warehouse_keeper' },
  { stepCode: 'delivery', stepName: 'Người giao hàng', requiredRole: 'warehouse_keeper', optional: true },
  { stepCode: 'warehouse', stepName: 'Thủ kho', requiredRole: 'warehouse_keeper' },
  { stepCode: 'chief_accountant', stepName: 'Kế toán trưởng', requiredRole: 'accountant' },
];

const OPENING_TEMPLATE: Omit<WorkflowStepTemplate, 'sequence'>[] = [
  { stepCode: 'creator', stepName: 'Người lập phiếu', requiredRole: 'warehouse_keeper' },
  { stepCode: 'warehouse', stepName: 'Thủ kho', requiredRole: 'warehouse_keeper' },
  { stepCode: 'chief_accountant', stepName: 'Kế toán trưởng', requiredRole: 'accountant' },
  { stepCode: 'admin', stepName: 'Admin doanh nghiệp', requiredRole: 'admin' as TenantRole },
];

const TEMPLATES: Record<DocumentType, WorkflowTemplate> = {
  stock_issue: {
    documentType: 'stock_issue',
    steps: FOUR_STEP_TEMPLATE.map((s, i) => ({ ...s, sequence: i + 1 })),
  },
  stock_receipt: {
    documentType: 'stock_receipt',
    steps: FOUR_STEP_TEMPLATE.map((s, i) => ({ ...s, sequence: i + 1 })),
  },
  stock_opening: {
    documentType: 'stock_opening',
    steps: OPENING_TEMPLATE.map((s, i) => ({ ...s, sequence: i + 1 })),
  },
};

export function getWorkflowTemplate(documentType: DocumentType): WorkflowTemplate {
  const template = TEMPLATES[documentType];
  if (!template) {
    throw new Error(`No workflow template for document type: ${documentType}`);
  }
  return template;
}
