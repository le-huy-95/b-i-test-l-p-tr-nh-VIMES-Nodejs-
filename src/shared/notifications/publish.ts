import { randomUUID } from 'crypto';
import { prisma } from '../../infra/prisma';
import { kafkaProducer } from '../../infra/kafka-producer';
import { enqueueNotificationOutbox } from '../../infra/notification-outbox';
import type { TenantNotificationEvent } from './event-types';

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

export function actorLabel(user: { name?: string | null; email?: string | null }): string {
  return user.name ?? user.email ?? 'User';
}
