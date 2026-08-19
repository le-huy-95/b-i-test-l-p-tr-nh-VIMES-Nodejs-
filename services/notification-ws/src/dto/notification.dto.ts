import { z } from 'zod';
import { NOTIFICATION_EVENT_TYPES, type NotificationEventType } from '../../../../src/shared/notifications/event-types';
import { recipientPolicySchema } from '../../../../src/shared/notifications/recipient-policy';

const boolFromQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
  onlyUnread: boolFromQuery,
  tenantId: z.string().optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const markReadSchema = z.object({
  notificationIds: z.array(z.string()).optional(),
  markAll: z.boolean().optional().default(false),
  tenantId: z.string().optional(),
});

export type MarkReadInput = z.infer<typeof markReadSchema>;

export const tenantNotificationEventSchema = z.object({
  eventId: z.string(),
  eventType: z.enum(
    Object.values(NOTIFICATION_EVENT_TYPES) as [NotificationEventType, ...NotificationEventType[]],
  ),
  tenantId: z.string(),
  actorUserId: z.string(),
  actorName: z.string(),
  occurredAt: z.string(),
  source: z.object({
    type: z.string(),
    id: z.string(),
    code: z.string().optional(),
  }),
  recipientPolicy: recipientPolicySchema,
  notification: z.object({
    title: z.string(),
    body: z.string(),
    targetType: z.string().optional(),
    targetId: z.string().optional(),
    routeName: z.string().optional(),
    routeParams: z.record(z.string(), z.string()).optional(),
    deeplink: z.string().optional(),
  }),
  data: z.record(z.string(), z.unknown()).optional(),
});

export interface NotificationItem {
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

export type WsInboundMessage = { type: 'PING' };

export type WsOutboundMessage =
  | { type: 'NOTIFICATION_NEW'; data: NotificationItem; unreadCount: number }
  | { type: 'PONG' };
