/**
 * Kafka consumer group `notification-ws`.
 *
 * Pipeline mỗi message:
 * 1. Parse JSON + validate Zod (tenantNotificationEventSchema)
 * 2. RecipientResolver → danh sách userId
 * 3. Batch song song (5 user/lần): createFromEvent (idempotent)
 * 4. Thành công → relay.pushNotification (Pub/Sub → WS)
 *
 * Message lỗi schema / JSON: log và skip (không retry vô hạn poison pill).
 * createFromEvent fail từng user: log, không làm fail cả batch.
 *
 * KAFKA_ENABLED !== 'true' → no-op, trả stop function rỗng.
 */
import { Kafka } from 'kafkajs';
import { z } from 'zod';
import { env } from '../../../../src/config/env';
import { prisma } from '../../../../src/infra/prisma';
import { tenantNotificationEventSchema } from '../dto/notification.dto';
import { RedisNotifCache } from '../infra/redis-notif-cache';
import { NotificationService } from '../modules/notification.service';
import { RecipientResolver } from '../modules/recipient.resolver';
import type Redis from 'ioredis';
import type { NotificationPushRelay } from '../ws/push-relay';

/** Số recipient xử lý song song mỗi vòng — giới hạn load DB khi broadcast tenant_roles. */
const RECIPIENT_CONCURRENCY = 5;

/**
 * Kết nối, subscribe topic, chạy consumer.
 * @returns hàm stop (disconnect) để graceful shutdown
 */
export async function startNotificationConsumer(
  redis: Redis | null,
  relay: NotificationPushRelay,
): Promise<() => Promise<void>> {
  if (env.KAFKA_ENABLED !== 'true') {
    console.log('[notification-ws] Kafka disabled, consumer not started');
    return async () => undefined;
  }

  const kafka = new Kafka({
    clientId: `${env.KAFKA_CLIENT_ID}-ws`,
    brokers: env.KAFKA_BROKERS.split(',').map((b) => b.trim()),
  });

  // Cùng groupId → nhiều replica chia partition, mỗi event chỉ 1 instance xử lý
  const consumer = kafka.consumer({ groupId: 'notification-ws' });
  const cache = new RedisNotifCache(redis);
  const notificationService = new NotificationService(prisma, cache);
  const recipientResolver = new RecipientResolver(prisma);

  await consumer.connect();
  await consumer.subscribe({ topic: env.KAFKA_TOPIC_NOTIFICATIONS, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(message.value.toString());
      } catch {
        console.error('[notification-ws] invalid JSON message');
        return;
      }

      const result = tenantNotificationEventSchema.safeParse(parsed);
      if (!result.success) {
        console.error('[notification-ws] invalid event payload', z.flattenError(result.error));
        return;
      }

      const event = result.data;
      const recipientIds = await recipientResolver.resolve(event.tenantId, event.recipientPolicy);
      const uniqueRecipients = [...new Set(recipientIds)];

      let cursor = 0;
      while (cursor < uniqueRecipients.length) {
        const batch = uniqueRecipients.slice(cursor, cursor + RECIPIENT_CONCURRENCY);
        cursor += RECIPIENT_CONCURRENCY;

        const results = await Promise.allSettled(
          batch.map(async (userId) => {
            const result = await notificationService.createFromEvent(userId, event);
            // null = đã tồn tại (idempotent) → không push trùng
            if (!result) return;
            await relay.pushNotification(userId, result.item, result.unreadCount);
          }),
        );

        for (const [index, res] of results.entries()) {
          if (res.status === 'rejected') {
            console.error(
              `[notification-ws] failed to deliver event ${event.eventId} to recipient ${batch[index]}:`,
              res.reason,
            );
          }
        }
      }
    },
  });

  console.log('[notification-ws] Kafka consumer started');

  return async () => {
    await consumer.disconnect();
  };
}
