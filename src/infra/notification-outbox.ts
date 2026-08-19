import type { PrismaClient } from './prisma-types';
import type { TenantNotificationEvent } from '../shared/notifications/event-types';
import { env } from '../config/env';

function computeRetryDelay(attempts: number): number {
  const base = env.OUTBOX_BASE_DELAY_MS;
  const max = env.OUTBOX_MAX_DELAY_MS;
  return Math.min(base * 2 ** attempts, max);
}

export async function enqueueNotificationOutbox(
  db: PrismaClient,
  event: TenantNotificationEvent,
): Promise<void> {
  await db.notificationOutbox.upsert({
    where: { eventId: event.eventId },
    create: {
      eventId: event.eventId,
      tenantId: event.tenantId,
      payload: event as never,
      status: 'pending',
      attempts: 0,
      availableAt: new Date(),
    },
    update: {
      payload: event as never,
      status: 'pending',
      availableAt: new Date(),
      lastError: null,
    },
  });
}

export async function markNotificationOutboxPublished(
  db: PrismaClient,
  id: string,
): Promise<void> {
  await db.notificationOutbox.update({
    where: { id },
    data: {
      status: 'published',
      publishedAt: new Date(),
      lastError: null,
    },
  });
}

export async function markNotificationOutboxFailed(
  db: PrismaClient,
  id: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  const row = await db.notificationOutbox.findUnique({
    where: { id },
    select: { attempts: true },
  });

  const attempts = (row?.attempts ?? 0) + 1;
  const maxAttempts = env.OUTBOX_MAX_ATTEMPTS;

  if (attempts >= maxAttempts) {
    await db.notificationOutbox.update({
      where: { id },
      data: {
        status: 'dead_letter',
        attempts,
        lastError: message,
      },
    });
    return;
  }

  const delay = computeRetryDelay(attempts);
  await db.notificationOutbox.update({
    where: { id },
    data: {
      status: 'failed',
      attempts,
      lastError: message,
      availableAt: new Date(Date.now() + delay),
    },
  });
}
