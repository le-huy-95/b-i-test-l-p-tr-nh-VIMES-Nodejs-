export const REALTIME_PUSH_CHANNEL = 'notif:push';

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

export interface RealtimePushPayload {
  userId: string;
  item: RealtimeNotificationItem;
  unreadCount: number;
}
