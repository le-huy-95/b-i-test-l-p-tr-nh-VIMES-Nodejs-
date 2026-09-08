/**
 * Kiểu dữ liệu cho kênh đẩy thông báo realtime (WebSocket / Redis pub-sub).
 *
 * Module này định nghĩa hợp đồng payload giữa backend và notification-ws service:
 * - `REALTIME_PUSH_CHANNEL`: tên kênh Redis publish
 * - `RealtimeNotificationItem`: một thông báo đã lưu DB, format gửi xuống client
 * - `RealtimePushPayload`: gói tin đẩy tới một user (item + số chưa đọc)
 *
 * Không chứa logic publish — chỉ types/constants dùng chung giữa API và WS worker.
 */

/** Tên kênh Redis dùng để publish sự kiện đẩy thông báo realtime tới notification-ws */
export const REALTIME_PUSH_CHANNEL = "notif:push";

/**
 * Một mục thông báo đã persist — mirror cấu trúc bản ghi Notification trong DB.
 * Client Flutter/mobile dùng routeName, routeParams, deeplink để điều hướng khi tap.
 */
export interface RealtimeNotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  tenantId: string | null;
  readAt: string | null;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  routeName: string | null;
  routeParams: Record<string, string> | null;
  deeplink: string | null;
  sourceType: string | null;
  sourceId: string | null;
  data: Record<string, unknown> | null;
}

/**
 * Payload publish lên kênh realtime cho một user cụ thể.
 * `unreadCount` giúp client cập nhật badge mà không cần gọi API đếm lại.
 */
export interface RealtimePushPayload {
  userId: string;
  item: RealtimeNotificationItem;
  unreadCount: number;
}
