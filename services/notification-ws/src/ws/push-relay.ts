import Redis from 'ioredis';
import { env } from '../../../../src/config/env';
import { REALTIME_PUSH_CHANNEL } from '../../../../src/shared/notifications/realtime';
import type { RealtimePushPayload } from '../../../../src/shared/notifications/realtime';
import type { NotificationItem, WsOutboundMessage } from '../dto/notification.dto';
import { connectionManager } from './connection-manager';

type PushPayload = RealtimePushPayload;

function createSubscriber(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: false,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  });
}

export class NotificationPushRelay {
  private readonly publisher: Redis | null;
  private readonly subscriber: Redis | null;
  private stopped = false;
  private started = false;

  constructor(redis: Redis | null) {
    this.publisher = redis;
    this.subscriber = redis ? createSubscriber() : null;
  }

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

  async pushNotification(userId: string, item: NotificationItem, unreadCount: number): Promise<void> {
    if (!this.publisher || !this.subscriber) {
      this.pushLocally(userId, item, unreadCount);
      return;
    }

    const payload: PushPayload = { userId, item, unreadCount };
    await this.publisher.publish(REALTIME_PUSH_CHANNEL, JSON.stringify(payload));
  }

  private pushLocally(userId: string, item: NotificationItem, unreadCount: number): void {
    const message: WsOutboundMessage = {
      type: 'NOTIFICATION_NEW',
      data: item,
      unreadCount,
    };
    connectionManager.push(userId, message);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.subscriber) {
      await this.subscriber.unsubscribe(REALTIME_PUSH_CHANNEL).catch(() => undefined);
      await this.subscriber.quit().catch(() => undefined);
    }
  }
}
