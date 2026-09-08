/**
 * Máy trạng thái (state machine) cho quy trình duyệt chứng từ.
 *
 * Xác định hành động nào được phép ở mỗi trạng thái chứng từ, kiểm tra bước đang chờ,
 * và tính trạng thái mới của chứng từ sau khi duyệt/từ chối/bỏ qua từng bước.
 */
import { AppError } from '../../utils/app-error';
import type {
  WorkflowAction,
  WorkflowDocumentStatus,
  WorkflowStepStatus,
} from './document-workflow.port';

// --- Bảng ánh xạ trạng thái chứng từ → hành động được phép ---
const ALLOWED_ACTIONS: Record<WorkflowDocumentStatus, WorkflowAction[]> = {
  draft: ['submit', 'cancel'],
  in_review: ['approve', 'reject', 'proxy_sign', 'skip', 'cancel'],
  approved: ['complete', 'cancel'],
  rejected: [],
  cancelled: [],
  completed: [],
};

// --- Các trạng thái kết thúc, không còn chuyển tiếp ---
const TERMINAL_STATUSES: WorkflowDocumentStatus[] = ['approved', 'rejected', 'cancelled', 'completed'];

// --- Kiểm tra hành động có hợp lệ với trạng thái hiện tại ---
export function assertActionAllowed(docStatus: WorkflowDocumentStatus, action: WorkflowAction): void {
  const allowed = ALLOWED_ACTIONS[docStatus];
  if (!allowed || !allowed.includes(action)) {
    throw new AppError(
      'INVALID_ACTION',
      409,
      `Action "${action}" is not allowed when document is "${docStatus}"`,
    );
  }
}

export function isTerminalStatus(status: WorkflowDocumentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

// --- Kiểm tra bước duyệt đang ở trạng thái chờ xử lý ---
export function assertStepPending(stepStatus: WorkflowStepStatus): void {
  if (stepStatus !== 'pending') {
    throw new AppError(
      'STEP_NOT_PENDING',
      409,
      `Step is "${stepStatus}", expected "pending"`,
    );
  }
}

// --- Tính trạng thái chứng từ sau hành động trên bước ---
export function computeDocumentStatus(
  steps: Array<{ status: WorkflowStepStatus; optional?: boolean }>,
  currentDocStatus: WorkflowDocumentStatus,
  action: WorkflowAction,
): WorkflowDocumentStatus {
  if (action === 'cancel') return 'cancelled';
  if (action === 'complete') return 'completed';

  if (action === 'submit') return 'in_review';

  if (action === 'reject') return 'rejected';

  if (action === 'approve' || action === 'proxy_sign' || action === 'skip') {
    const nonTerminalSteps = steps.filter(
      (s) => s.status === 'pending' || s.status === 'approved' || s.status === 'signed_by_proxy' || s.status === 'skipped',
    );

    const hasRejected = steps.some((s) => s.status === 'rejected');
    if (hasRejected) return 'rejected';

    const allDone = nonTerminalSteps.every(
      (s) => s.status === 'approved' || s.status === 'signed_by_proxy' || s.status === 'skipped',
    );

    if (allDone) return 'approved';
    return 'in_review';
  }

  return currentDocStatus;
}

// --- Kiểm tra có thể gán lại người duyệt cho bước ---
export function assertCanAssignStep(stepStatus: WorkflowStepStatus): void {
  if (stepStatus !== 'pending') {
    throw new AppError('STEP_NOT_PENDING', 409, `Cannot reassign a step that is "${stepStatus}"`);
  }
}
