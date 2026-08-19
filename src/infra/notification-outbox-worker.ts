import { prisma } from './prisma';
import { env } from '../config/env';
import { kafkaProducer } from './kafka-producer';
import type { Prisma } from './prisma-types';
import type { TenantNotificationEvent } from '../shared/notifications/event-types';
import {
  markNotificationOutboxFailed,
  markNotificationOutboxPublished,
} from './notification-outbox';

type OutboxRow = {
  id: string;
  payload: Prisma.JsonValue;
};

function isNotificationEvent(value: unknown): value is TenantNotificationEvent {
  return typeof value === 'object' && value !== null && 'eventId' in value && 'tenantId' in value;
}

export class NotificationOutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  async start(): Promise<void> {
    if (this.timer) return;
    await this.flushOnce();
    this.timer = setInterval(() => {
      void this.flushOnce();
    }, env.OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async flushOnce(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;

    try {
      const claimed = await this.claimBatch();
      await this.processBatch(claimed);
    } catch (err) {
      console.error('[outbox-worker] flush error:', err);
    } finally {
      this.running = false;
    }
  }

  private async claimBatch(): Promise<OutboxRow[]> {
    const now = new Date();

    const rows = await prisma.$queryRaw<OutboxRow[]>`
      UPDATE notification_outbox
      SET status = 'processing'
      WHERE id IN (
        SELECT id FROM notification_outbox
        WHERE status IN ('pending', 'failed')
          AND available_at <= ${now}
        ORDER BY created_at ASC
        LIMIT ${env.OUTBOX_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, payload
    `;

    return rows;
  }

  private async processBatch(rows: OutboxRow[]): Promise<void> {
    for (const row of rows) {
      try {
        const event = row.payload as unknown as TenantNotificationEvent;
        if (!isNotificationEvent(event)) {
          await markNotificationOutboxFailed(prisma, row.id, new Error('Invalid outbox payload'));
          continue;
        }

        await kafkaProducer.publish(event);
        await markNotificationOutboxPublished(prisma, row.id);
      } catch (error) {
        await markNotificationOutboxFailed(prisma, row.id, error);
      }
    }
  }
}

export const notificationOutboxWorker = new NotificationOutboxWorker();
