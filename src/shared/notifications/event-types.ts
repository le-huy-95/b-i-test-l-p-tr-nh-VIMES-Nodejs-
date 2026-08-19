import type { RecipientPolicy } from './recipient-policy';

export const NOTIFICATION_EVENT_TYPES = {
  INVITATION_CREATED: 'INVITATION_CREATED',
  INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
  INVITATION_DECLINED: 'INVITATION_DECLINED',
  MEMBERSHIP_REMOVED: 'MEMBERSHIP_REMOVED',
  USER_CREATED: 'USER_CREATED',
  USER_LOGIN: 'USER_LOGIN',
  RECEIPT_SUBMITTED: 'RECEIPT_SUBMITTED',
  RECEIPT_APPROVED: 'RECEIPT_APPROVED',
  RECEIPT_REJECTED: 'RECEIPT_REJECTED',
  RECEIPT_COMPLETED: 'RECEIPT_COMPLETED',
  RECEIPT_CANCELLED: 'RECEIPT_CANCELLED',
  ISSUE_SUBMITTED: 'ISSUE_SUBMITTED',
  ISSUE_APPROVED: 'ISSUE_APPROVED',
  ISSUE_REJECTED: 'ISSUE_REJECTED',
  ISSUE_COMPLETED: 'ISSUE_COMPLETED',
  ISSUE_CANCELLED: 'ISSUE_CANCELLED',
} as const;

export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[keyof typeof NOTIFICATION_EVENT_TYPES];

export interface TenantNotificationEvent {
  eventId: string;
  eventType: NotificationEventType;
  tenantId: string;
  actorUserId: string;
  actorName: string;
  occurredAt: string;
  source: { type: string; id: string; code?: string };
  recipientPolicy: RecipientPolicy;
  notification: {
    title: string;
    body: string;
    targetType?: string;
    targetId?: string;
    routeName?: string;
    routeParams?: Record<string, string>;
    deeplink?: string;
  };
  data?: Record<string, unknown>;
}

export const EVENT_TYPE_TO_NOTIFICATION_TYPE: Record<
  NotificationEventType,
  string
> = {
  INVITATION_CREATED: 'invitation_created',
  INVITATION_ACCEPTED: 'invitation_accepted',
  INVITATION_DECLINED: 'invitation_declined',
  MEMBERSHIP_REMOVED: 'membership_removed',
  USER_CREATED: 'user_created',
  USER_LOGIN: 'user_login',
  RECEIPT_SUBMITTED: 'receipt_submitted',
  RECEIPT_APPROVED: 'receipt_approved',
  RECEIPT_REJECTED: 'receipt_rejected',
  RECEIPT_COMPLETED: 'receipt_completed',
  RECEIPT_CANCELLED: 'receipt_cancelled',
  ISSUE_SUBMITTED: 'issue_submitted',
  ISSUE_APPROVED: 'issue_approved',
  ISSUE_REJECTED: 'issue_rejected',
  ISSUE_COMPLETED: 'issue_completed',
  ISSUE_CANCELLED: 'issue_cancelled',
};
