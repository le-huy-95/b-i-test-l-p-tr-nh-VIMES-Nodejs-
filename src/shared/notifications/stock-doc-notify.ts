import { NOTIFICATION_EVENT_TYPES } from './event-types';
import { publishTenantNotification, actorLabel } from './publish';

export interface StockDocActor {
  userId: string;
  name?: string | null;
  email?: string | null;
}

interface StockDocInfo {
  id: string;
  code: string;
  createdById: string;
}

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
