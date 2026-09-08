/**
 * Thông báo in-app cho vòng đời phiếu nhập kho và phiếu xuất kho.
 *
 * Mỗi hàm `notify*` được gọi từ service chứng từ (stock-receipt, stock-issue)
 * khi trạng thái thay đổi (gửi duyệt, duyệt, từ chối, hoàn tất, hủy).
 *
 * Quy tắc người nhận:
 * - SUBMITTED → admin + accountant (tenant_roles) — cần duyệt
 * - APPROVED / REJECTED / COMPLETED / CANCELLED → người tạo phiếu (source_creator)
 *
 * Tất cả hàm delegate sang `publishTenantNotification` với eventType, title/body
 * tiếng Việt và metadata điều hướng Flutter (routeName, deeplink).
 */

import { NOTIFICATION_EVENT_TYPES } from './event-types';
import { publishTenantNotification, actorLabel } from './publish';

/** Thông tin người thực hiện hành động trên chứng từ kho */
export interface StockDocActor {
  userId: string;
  name?: string | null;
  email?: string | null;
}

/** Thông tin tối thiểu của phiếu nhập/xuất cần cho thông báo */
interface StockDocInfo {
  id: string;
  code: string;
  createdById: string;
}

// ─── Phiếu nhập kho (Stock Receipt) ─────────────────────────────────────────

/** Thông báo khi phiếu nhập được gửi chờ duyệt — gửi tới admin và kế toán */
export async function notifyReceiptSubmitted(
  tenantId: string,
  receipt: StockDocInfo,
  actor: StockDocActor,
): Promise<void> {
  const name = actorLabel(actor);
  await publishTenantNotification({
    eventType: NOTIFICATION_EVENT_TYPES.RECEIPT_SUBMITTED,
    tenantId,
    actorUserId: actor.userId,
    actorName: name,
    source: { type: 'stock_receipt', id: receipt.id, code: receipt.code },
    recipientPolicy: { type: 'tenant_roles', roles: ['admin', 'accountant'] },
    notification: {
      title: 'Phiếu nhập chờ duyệt',
      body: `${name} đã gửi phiếu nhập ${receipt.code}`,
      targetType: 'stock_receipt',
      targetId: receipt.id,
      routeName: 'stock_receipt_detail',
      routeParams: { receiptId: receipt.id, tenantId },
      deeplink: `myapp://stock-receipts/${receipt.id}`,
    },
  });
}

/** Thông báo khi phiếu nhập được duyệt — gửi tới người tạo phiếu */
export async function notifyReceiptApproved(
  tenantId: string,
  receipt: StockDocInfo,
  actor: StockDocActor,
): Promise<void> {
  const name = actorLabel(actor);
  await publishTenantNotification({
    eventType: NOTIFICATION_EVENT_TYPES.RECEIPT_APPROVED,
    tenantId,
    actorUserId: actor.userId,
    actorName: name,
    source: { type: 'stock_receipt', id: receipt.id, code: receipt.code },
    recipientPolicy: { type: 'source_creator', createdByUserId: receipt.createdById },
    notification: {
      title: 'Phiếu nhập đã duyệt',
      body: `${name} đã duyệt phiếu nhập ${receipt.code}`,
      targetType: 'stock_receipt',
      targetId: receipt.id,
      routeName: 'stock_receipt_detail',
      routeParams: { receiptId: receipt.id, tenantId },
      deeplink: `myapp://stock-receipts/${receipt.id}`,
    },
  });
}

/** Thông báo khi phiếu nhập bị từ chối — gửi tới người tạo phiếu */
export async function notifyReceiptRejected(
  tenantId: string,
  receipt: StockDocInfo,
  actor: StockDocActor,
): Promise<void> {
  const name = actorLabel(actor);
  await publishTenantNotification({
    eventType: NOTIFICATION_EVENT_TYPES.RECEIPT_REJECTED,
    tenantId,
    actorUserId: actor.userId,
    actorName: name,
    source: { type: 'stock_receipt', id: receipt.id, code: receipt.code },
    recipientPolicy: { type: 'source_creator', createdByUserId: receipt.createdById },
    notification: {
      title: 'Phiếu nhập bị từ chối',
      body: `${name} đã từ chối phiếu nhập ${receipt.code}`,
      targetType: 'stock_receipt',
      targetId: receipt.id,
      routeName: 'stock_receipt_detail',
      routeParams: { receiptId: receipt.id, tenantId },
      deeplink: `myapp://stock-receipts/${receipt.id}`,
    },
  });
}

/** Thông báo khi phiếu nhập hoàn tất xử lý kho — gửi tới người tạo phiếu */
export async function notifyReceiptCompleted(
  tenantId: string,
  receipt: StockDocInfo,
  actor: StockDocActor,
): Promise<void> {
  const name = actorLabel(actor);
  await publishTenantNotification({
    eventType: NOTIFICATION_EVENT_TYPES.RECEIPT_COMPLETED,
    tenantId,
    actorUserId: actor.userId,
    actorName: name,
    source: { type: 'stock_receipt', id: receipt.id, code: receipt.code },
    recipientPolicy: { type: 'source_creator', createdByUserId: receipt.createdById },
    notification: {
      title: 'Phiếu nhập hoàn tất',
      body: `${name} đã hoàn tất phiếu nhập ${receipt.code}`,
      targetType: 'stock_receipt',
      targetId: receipt.id,
      routeName: 'stock_receipt_detail',
      routeParams: { receiptId: receipt.id, tenantId },
      deeplink: `myapp://stock-receipts/${receipt.id}`,
    },
  });
}

/** Thông báo khi phiếu nhập bị hủy — gửi tới người tạo phiếu */
export async function notifyReceiptCancelled(
  tenantId: string,
  receipt: StockDocInfo,
  actor: StockDocActor,
): Promise<void> {
  const name = actorLabel(actor);
  await publishTenantNotification({
    eventType: NOTIFICATION_EVENT_TYPES.RECEIPT_CANCELLED,
    tenantId,
    actorUserId: actor.userId,
    actorName: name,
    source: { type: 'stock_receipt', id: receipt.id, code: receipt.code },
    recipientPolicy: { type: 'source_creator', createdByUserId: receipt.createdById },
    notification: {
      title: 'Phiếu nhập đã hủy',
      body: `${name} đã hủy phiếu nhập ${receipt.code}`,
      targetType: 'stock_receipt',
      targetId: receipt.id,
      routeName: 'stock_receipt_detail',
      routeParams: { receiptId: receipt.id, tenantId },
      deeplink: `myapp://stock-receipts/${receipt.id}`,
    },
  });
}

// ─── Phiếu xuất kho (Stock Issue) ───────────────────────────────────────────

/** Thông báo khi phiếu xuất được gửi chờ duyệt — gửi tới admin và kế toán */
export async function notifyIssueSubmitted(
  tenantId: string,
  issue: StockDocInfo,
  actor: StockDocActor,
): Promise<void> {
  const name = actorLabel(actor);
  await publishTenantNotification({
    eventType: NOTIFICATION_EVENT_TYPES.ISSUE_SUBMITTED,
    tenantId,
    actorUserId: actor.userId,
    actorName: name,
    source: { type: 'stock_issue', id: issue.id, code: issue.code },
    recipientPolicy: { type: 'tenant_roles', roles: ['admin', 'accountant'] },
    notification: {
      title: 'Phiếu xuất chờ duyệt',
      body: `${name} đã gửi phiếu xuất ${issue.code}`,
      targetType: 'stock_issue',
      targetId: issue.id,
      routeName: 'stock_issue_detail',
      routeParams: { issueId: issue.id, tenantId },
      deeplink: `myapp://stock-issues/${issue.id}`,
    },
  });
}

/** Thông báo khi phiếu xuất được duyệt — gửi tới người tạo phiếu */
export async function notifyIssueApproved(
  tenantId: string,
  issue: StockDocInfo,
  actor: StockDocActor,
): Promise<void> {
  const name = actorLabel(actor);
  await publishTenantNotification({
    eventType: NOTIFICATION_EVENT_TYPES.ISSUE_APPROVED,
    tenantId,
    actorUserId: actor.userId,
    actorName: name,
    source: { type: 'stock_issue', id: issue.id, code: issue.code },
    recipientPolicy: { type: 'source_creator', createdByUserId: issue.createdById },
    notification: {
      title: 'Phiếu xuất đã duyệt',
      body: `${name} đã duyệt phiếu xuất ${issue.code}`,
      targetType: 'stock_issue',
      targetId: issue.id,
      routeName: 'stock_issue_detail',
      routeParams: { issueId: issue.id, tenantId },
      deeplink: `myapp://stock-issues/${issue.id}`,
    },
  });
}

/** Thông báo khi phiếu xuất bị từ chối — gửi tới người tạo phiếu */
export async function notifyIssueRejected(
  tenantId: string,
  issue: StockDocInfo,
  actor: StockDocActor,
): Promise<void> {
  const name = actorLabel(actor);
  await publishTenantNotification({
    eventType: NOTIFICATION_EVENT_TYPES.ISSUE_REJECTED,
    tenantId,
    actorUserId: actor.userId,
    actorName: name,
    source: { type: 'stock_issue', id: issue.id, code: issue.code },
    recipientPolicy: { type: 'source_creator', createdByUserId: issue.createdById },
    notification: {
      title: 'Phiếu xuất bị từ chối',
      body: `${name} đã từ chối phiếu xuất ${issue.code}`,
      targetType: 'stock_issue',
      targetId: issue.id,
      routeName: 'stock_issue_detail',
      routeParams: { issueId: issue.id, tenantId },
      deeplink: `myapp://stock-issues/${issue.id}`,
    },
  });
}

/** Thông báo khi phiếu xuất hoàn tất xử lý kho — gửi tới người tạo phiếu */
export async function notifyIssueCompleted(
  tenantId: string,
  issue: StockDocInfo,
  actor: StockDocActor,
): Promise<void> {
  const name = actorLabel(actor);
  await publishTenantNotification({
    eventType: NOTIFICATION_EVENT_TYPES.ISSUE_COMPLETED,
    tenantId,
    actorUserId: actor.userId,
    actorName: name,
    source: { type: 'stock_issue', id: issue.id, code: issue.code },
    recipientPolicy: { type: 'source_creator', createdByUserId: issue.createdById },
    notification: {
      title: 'Phiếu xuất hoàn tất',
      body: `${name} đã hoàn tất phiếu xuất ${issue.code}`,
      targetType: 'stock_issue',
      targetId: issue.id,
      routeName: 'stock_issue_detail',
      routeParams: { issueId: issue.id, tenantId },
      deeplink: `myapp://stock-issues/${issue.id}`,
    },
  });
}

/** Thông báo khi phiếu xuất bị hủy — gửi tới người tạo phiếu */
export async function notifyIssueCancelled(
  tenantId: string,
  issue: StockDocInfo,
  actor: StockDocActor,
): Promise<void> {
  const name = actorLabel(actor);
  await publishTenantNotification({
    eventType: NOTIFICATION_EVENT_TYPES.ISSUE_CANCELLED,
    tenantId,
    actorUserId: actor.userId,
    actorName: name,
    source: { type: 'stock_issue', id: issue.id, code: issue.code },
    recipientPolicy: { type: 'source_creator', createdByUserId: issue.createdById },
    notification: {
      title: 'Phiếu xuất đã hủy',
      body: `${name} đã hủy phiếu xuất ${issue.code}`,
      targetType: 'stock_issue',
      targetId: issue.id,
      routeName: 'stock_issue_detail',
      routeParams: { issueId: issue.id, tenantId },
      deeplink: `myapp://stock-issues/${issue.id}`,
    },
  });
}
