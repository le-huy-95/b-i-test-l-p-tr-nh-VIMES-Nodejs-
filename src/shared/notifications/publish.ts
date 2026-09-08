/**
 * Xuất bản sự kiện thông báo cấp tenant.
 *
 * Hàm `publishTenantNotification` là điểm vào chung khi module nghiệp vụ cần
 * gửi thông báo in-app:
 * 1. Bổ sung eventId (UUID) và occurredAt (ISO timestamp)
 * 2. Ghi vào notification outbox (đảm bảo at-least-once qua transaction)
 * 3. Publish lên Kafka để consumer tạo bản ghi Notification và đẩy realtime
 *
 * Hàm `actorLabel` chuẩn hóa tên hiển thị người thực hiện hành động trong body thông báo.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../infra/prisma';
import { kafkaProducer } from '../../infra/kafka-producer';
import { enqueueNotificationOutbox } from '../../infra/notification-outbox';
import type { TenantNotificationEvent } from './event-types';

/**
 * Publish một sự kiện thông báo tenant.
 *
 * Caller truyền payload không có eventId/occurredAt — hàm tự sinh và ghi outbox + Kafka.
 * Không throw nếu Kafka tạm lỗi (outbox đảm bảo retry); lỗi được log ở tầng infra.
 */
export async function publishTenantNotification(
  event: Omit<TenantNotificationEvent, 'eventId' | 'occurredAt'>,
): Promise<void> {
  const fullEvent: TenantNotificationEvent = {
    ...event,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
  };

  await enqueueNotificationOutbox(prisma, fullEvent);
  await kafkaProducer.publish(fullEvent);
}

/**
 * Tạo nhãn hiển thị cho người thực hiện: ưu tiên name, fallback email, cuối cùng 'User'.
 */
export function actorLabel(user: { name?: string | null; email?: string | null }): string {
  return user.name ?? user.email ?? 'User';
}
