/**
 * Đẩy thông báo realtime đa instance qua Redis Pub/Sub.
 *
 * Vấn đề: ConnectionManager chỉ biết socket trên process hiện tại.
 * Nếu chạy nhiều replica, user A có thể WS vào replica 1, Kafka consume ở replica 2.
 *
 * Cách làm:
 * - pushNotification() luôn PUBLISH lên kênh chung
 * - Mọi replica SUBSCRIBE kênh đó rồi pushLocally() vào socket local
 *
 * Không có Redis: fallback pushLocally (single-process).
 */
import Redis from 'ioredis';
import { env } from '../../../../src/config/env';
import { REALTIME_PUSH_CHANNEL } from '../../../../src/shared/notifications/realtime';
import type { RealtimePushPayload } from '../../../../src/shared/notifications/realtime';
import type { NotificationItem, WsOutboundMessage } from '../dto/notification.dto';
import { connectionManager } from './connection-manager';

type PushPayload = RealtimePushPayload;

/**
 * Tạo Redis client riêng cho SUBSCRIBE.
 * ioredis: connection đang subscribe không dùng được GET/SET/PUBLISH,
 * nên không tái sử dụng client cache.
 */
function createSubscriber(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: false,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  });
}

export class NotificationPushRelay {
  /** Client publish (dùng chung với cache nếu có). */
  private readonly publisher: Redis | null;
  /** Client subscribe riêng. */
  private readonly subscriber: Redis | null;
  private stopped = false;
  private started = false;

  constructor(redis: Redis | null) {
    this.publisher = redis;
    this.subscriber = redis ? createSubscriber() : null;
  }

  /**
   * Subscribe kênh REALTIME_PUSH_CHANNEL.
   * Gọi 1 lần lúc boot; Redis down thì log và chạy local-only.
   */
  async start(): Promise<void> {
    if (!this.subscriber || this.started) {
      if (!this.subscriber) {
        console.warn('[notification-ws] Redis unavailable, push relay running local-only');
      }
      return;
    }

    this.started = true;
    this.subscriber.on('message', (_channel, raw) => {
      if (this.stopped) return;
      try {
        const payload = JSON.parse(raw) as PushPayload;
        this.pushLocally(payload.userId, payload.item, payload.unreadCount);
      } catch {
        // ignore malformed broadcast messages
      }
    });

    await this.subscriber.subscribe(REALTIME_PUSH_CHANNEL);
    console.log(`[notification-ws] push relay subscribed to ${REALTIME_PUSH_CHANNEL}`);
  }

  /**
   * Điểm gọi từ Kafka consumer sau khi tạo Notification thành công.
   * Có Redis → publish (mọi replica nhận, kể cả chính mình).
   * Không Redis → push thẳng socket local.
   */
  async pushNotification(userId: string, item: NotificationItem, unreadCount: number): Promise<void> {
    if (!this.publisher || !this.subscriber) {
      this.pushLocally(userId, item, unreadCount);
      return;
    }

    const payload: PushPayload = { userId, item, unreadCount };
    await this.publisher.publish(REALTIME_PUSH_CHANNEL, JSON.stringify(payload));
  }

  /** Gửi JSON NOTIFICATION_NEW tới mọi socket đang mở của user trên process này. */
  private pushLocally(userId: string, item: NotificationItem, unreadCount: number): void {
    const message: WsOutboundMessage = {
      type: 'NOTIFICATION_NEW',
      data: item,
      unreadCount,
    };
    connectionManager.push(userId, message);
  }

  /** Unsubscribe + quit subscriber khi shutdown (không quit publisher — thuộc redis.ts). */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.subscriber) {
      await this.subscriber.unsubscribe(REALTIME_PUSH_CHANNEL).catch(() => undefined);
      await this.subscriber.quit().catch(() => undefined);
    }
  }
}
