/**
 * Định nghĩa loại sự kiện thông báo và cấu trúc payload sự kiện tenant.
 *
 * Module này là nguồn sự thật (single source of truth) cho:
 * - Hằng số `NOTIFICATION_EVENT_TYPES` — mã sự kiện dùng trong Kafka/outbox
 * - Kiểu `TenantNotificationEvent` — payload đầy đủ khi publish thông báo
 * - Bảng ánh xạ `EVENT_TYPE_TO_NOTIFICATION_TYPE` — chuyển mã sự kiện sang
 *   loại notification lưu DB (snake_case) cho client hiển thị
 *
 * Các module notify (stock-doc, direct-notify) import từ đây để đảm bảo
 * eventType nhất quán trên toàn hệ thống.
 */

import type { RecipientPolicy } from './recipient-policy';

/** Danh sách mã sự kiện thông báo — dùng làm eventType khi publish */
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
  ISSUE_OUT_OF_STOCK: 'ISSUE_OUT_OF_STOCK',
  ISSUE_STOCK_AVAILABLE: 'ISSUE_STOCK_AVAILABLE',
} as const;

/** Union type của tất cả giá trị trong NOTIFICATION_EVENT_TYPES */
export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[keyof typeof NOTIFICATION_EVENT_TYPES];

/**
 * Payload sự kiện thông báo cấp tenant — được ghi outbox và publish Kafka.
 *
 * `recipientPolicy` quyết định ai nhận thông báo (xem recipient-policy.ts).
 * `notification` chứa nội dung hiển thị và metadata điều hướng app (route, deeplink).
 */
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

/**
 * Ánh xạ mã sự kiện (SCREAMING_SNAKE) sang loại notification trong DB (snake_case).
 * Consumer dùng bảng này khi tạo bản ghi Notification cho từng user.
 */
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
  ISSUE_OUT_OF_STOCK: 'issue_out_of_stock',
  ISSUE_STOCK_AVAILABLE: 'issue_stock_available',
};
