/**
 * Tạo 3 notification mẫu và đẩy realtime tới user để test frontend nhận WS push.
 *
 * Usage:
 *   bun run scripts/send-test-notifications.ts                       # dùng user đầu tiên có tenant
 *   bun run scripts/send-test-notifications.ts lehuy2606it@gmail.com # theo email / userId
 *   bun run scripts/send-test-notifications.ts <email> --no-self-test # bỏ qua bước tự verify WS
 *
 * Cách hoạt động:
 *   1. Tìm user nhận thông báo (theo arg, hoặc mặc định user đầu tiên có tenant).
 *   2. Tạo 3 notification mẫu (receipt_submitted, receipt_approved, issue_submitted).
 *   3. Đẩy realtime:
 *      - Nếu KAFKA_ENABLED=true  → ghi outbox + publish lên Kafka (đúng pipeline production).
 *      - Nếu KAFKA_ENABLED=false → tạo record trực tiếp + publish lên Redis channel
 *        `notif:ws:push` (giống hệt việc consumer gọi NotificationPushRelay.pushNotification).
 *   4. Mặc định tự mở 1 WebSocket tới ws://<host>:3001/notifications để xác nhận realtime
 *      đã đến đúng user (bật --no-self-test nếu không muốn).
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  NotificationType,
  NotificationTargetType,
} from '../src/generated/prisma';
import { Pool } from 'pg';
import type { TenantNotificationEvent } from '../src/shared/notifications/event-types';
import { EVENT_TYPE_TO_NOTIFICATION_TYPE } from '../src/shared/notifications/event-types';

const PUSH_CHANNEL = 'notif:ws:push';
const SELF_TEST_TIMEOUT_MS = 10_000;
const WS_CONNECT_TIMEOUT_MS = 5_000;

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targetArg = args[0];
const doSelfTest = !process.argv.includes('--no-self-test');

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

function createPrisma(): { prisma: PrismaClient; pool: Pool } {
  const pool = new Pool({ connectionString: requireDatabaseUrl() });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

function toItem(row: {
  id: string;
  type: string;
  title: string;
  body: string;
  tenantId: string | null;
  readAt: Date | null;
  createdAt: Date;
  actorUserId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  routeName: string | null;
  routeParams: unknown;
  deeplink: string | null;
  sourceType: string | null;
  sourceId: string | null;
  data: unknown;
}): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    tenantId: row.tenantId,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    targetType: row.targetType,
    targetId: row.targetId,
    routeName: row.routeName,
    routeParams: (row.routeParams as Record<string, string> | null) ?? null,
    deeplink: row.deeplink,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    data: (row.data as Record<string, unknown> | null) ?? null,
  };
}

function buildSampleEvents(userId: string, tenantId: string, actorName: string): TenantNotificationEvent[] {
  const year = new Date().getFullYear();
  const now = () => new Date().toISOString();

  const receiptSubmittedId = `notif-test-receipt-${randomUUID().slice(0, 8)}`;
  const receiptApprovedId = `notif-test-receipt-approved-${randomUUID().slice(0, 8)}`;
  const issueSubmittedId = `notif-test-issue-${randomUUID().slice(0, 8)}`;

  return [
    {
      eventId: randomUUID(),
      eventType: 'RECEIPT_SUBMITTED',
      tenantId,
      actorUserId: userId,
      actorName,
      occurredAt: now(),
      source: {
        type: 'stock_receipt',
        id: receiptSubmittedId,
        code: `PNK-${year}-000009`,
      },
      recipientPolicy: { type: 'explicit_users', userIds: [userId] },
      notification: {
        title: 'Phiếu nhập kho chờ duyệt',
        body: `Phiếu nhập PNK-${year}-000009 vừa được gửi để duyệt. Vui lòng kiểm tra và phê duyệt.`,
        targetType: 'stock_receipt',
        targetId: receiptSubmittedId,
        routeName: 'stock_receipt_detail',
        routeParams: { receiptId: receiptSubmittedId, tenantId },
        deeplink: `myapp://stock-receipts/${receiptSubmittedId}`,
      },
      data: { code: `PNK-${year}-000009`, totalAmount: 4250000, warehouseName: 'Kho Hà Nội' },
    },
    {
      eventId: randomUUID(),
      eventType: 'RECEIPT_APPROVED',
      tenantId,
      actorUserId: userId,
      actorName,
      occurredAt: now(),
      source: {
        type: 'stock_receipt',
        id: receiptApprovedId,
        code: `PNK-${year}-000010`,
      },
      recipientPolicy: { type: 'explicit_users', userIds: [userId] },
      notification: {
        title: 'Phiếu nhập kho đã được duyệt',
        body: `Phiếu nhập PNK-${year}-000010 đã được duyệt bởi ${actorName}.`,
        targetType: 'stock_receipt',
        targetId: receiptApprovedId,
        routeName: 'stock_receipt_detail',
        routeParams: { receiptId: receiptApprovedId, tenantId },
        deeplink: `myapp://stock-receipts/${receiptApprovedId}`,
      },
      data: { code: `PNK-${year}-000010`, warehouseName: 'Kho TP.HCM' },
    },
    {
      eventId: randomUUID(),
      eventType: 'ISSUE_SUBMITTED',
      tenantId,
      actorUserId: userId,
      actorName,
      occurredAt: now(),
      source: {
        type: 'stock_issue',
        id: issueSubmittedId,
        code: `PXK-${year}-000007`,
      },
      recipientPolicy: { type: 'explicit_users', userIds: [userId] },
      notification: {
        title: 'Phiếu xuất kho chờ duyệt',
        body: `Phiếu xuất PXK-${year}-000007 vừa được gửi để duyệt. Vui lòng kiểm tra và phê duyệt.`,
        targetType: 'stock_issue',
        targetId: issueSubmittedId,
        routeName: 'stock_issue_detail',
        routeParams: { issueId: issueSubmittedId, tenantId },
        deeplink: `myapp://stock-issues/${issueSubmittedId}`,
      },
      data: { code: `PXK-${year}-000007`, totalAmount: 9600000, warehouseName: 'Kho Hà Nội' },
    },
  ];
}

/** Đẩy qua Kafka giống pipeline production: outbox + producer. */
async function deliverViaKafka(prisma: PrismaClient, event: TenantNotificationEvent): Promise<void> {
  await prisma.notificationOutbox.upsert({
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

  const kafka = new Kafka({
    clientId: 'notif-test-script',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9094').split(',').map((b) => b.trim()),
  });
  const producer = kafka.producer();
  await producer.connect();
  try {
    await producer.send({
      topic: process.env.KAFKA_TOPIC_NOTIFICATIONS ?? 'tenant-notification-events',
      messages: [{ key: event.tenantId, value: JSON.stringify(event) }],
    });
  } finally {
    await producer.disconnect().catch(() => undefined);
  }
}

/**
 * Tạo notification trong DB rồi publish lên Redis `notif:ws:push`.
 * Giống hệt những gì consumer trong notification-ws làm sau khi nhận Kafka event:
 * NotificationService.createFromEvent + NotificationPushRelay.pushNotification.
 */
async function deliverDirect(
  prisma: PrismaClient,
  redis: Redis,
  userId: string,
  event: TenantNotificationEvent,
): Promise<Record<string, unknown>> {
  const type = EVENT_TYPE_TO_NOTIFICATION_TYPE[event.eventType];

  const row = await prisma.notification.create({
    data: {
      userId,
      tenantId: event.tenantId,
      type: type as NotificationType,
      title: event.notification.title,
      body: event.notification.body,
      data: event.data as never,
      eventId: event.eventId,
      sourceType: event.source.type,
      sourceId: event.source.id,
      actorUserId: event.actorUserId,
      actorName: event.actorName,
      targetType: event.notification.targetType as NotificationTargetType | undefined,
      targetId: event.notification.targetId,
      routeName: event.notification.routeName,
      routeParams: event.notification.routeParams as never,
      deeplink: event.notification.deeplink,
    },
  });

  const unreadCount = await prisma.notification.count({
    where: { userId, readAt: null },
  });
  await redis.set(`notif:unread:${userId}`, String(unreadCount));

  // Invalidate list cache của user (giống RedisNotifCache.invalidateUser)
  const pattern = `notif:list:${userId}:latest:*`;
  const stream = redis.scanStream({ match: pattern, count: 100 });
  const keys: string[] = [];
  for await (const batch of stream) {
    keys.push(...(batch as string[]));
  }
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  const item = toItem(row);
  await redis.publish(PUSH_CHANNEL, JSON.stringify({ userId, item, unreadCount }));
  return item;
}

function resolveTargetUser(
  prisma: PrismaClient,
  arg: string | undefined,
): Promise<{ user: { id: string; email: string | null; name: string | null; tokenVersion: number }; tenantId: string; tenantName: string }> {
  return (async () => {
    let user:
      | { id: string; email: string | null; name: string | null; tokenVersion: number }
      | null = null;

    if (arg) {
      user = await prisma.user.findUnique({
        where: arg.includes('@') ? { email: arg } : { id: arg },
        select: { id: true, email: true, name: true, tokenVersion: true },
      });
      if (!user) {
        throw new Error(`Không tìm thấy user: ${arg}`);
      }
    } else {
      const users = await prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, email: true, name: true, tokenVersion: true },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const candidate of users) {
        const membership = await prisma.userTenant.findFirst({
          where: { userId: candidate.id, isActive: true },
          select: { tenantId: true, tenant: { select: { name: true } } },
        });
        if (membership) {
          user = candidate;
          break;
        }
      }
      if (!user) {
        const sample = users.map((u) => u.email ?? u.id).join('\n  ');
        throw new Error(`Không có user nào có tenant. Các user hiện có:\n  ${sample}\nHãy truyền email: npx tsx scripts/send-test-notifications.ts <email>`);
      }
    }

    const membership = await prisma.userTenant.findFirst({
      where: { userId: user.id, isActive: true },
      select: { tenantId: true, tenant: { select: { name: true } } },
    });
    if (!membership) {
      throw new Error(`User ${user.email ?? user.id} chưa thuộc tenant nào (user_tenants trống).`);
    }

    return { user, tenantId: membership.tenantId, tenantName: membership.tenant.name };
  })();
}

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Không kết nối được WebSocket (notification-ws service không chạy? port 3001)'));
    }, WS_CONNECT_TIMEOUT_MS);

    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForNotifications(
  ws: WebSocket,
  expected: number,
  timeoutMs: number,
): Promise<string[]> {
  return new Promise((resolve) => {
    const received: string[] = [];
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      resolve(received);
    }, timeoutMs);

    function onMessage(raw: WebSocket.RawData): void {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; data?: { title?: string } };
        if (msg.type === 'NOTIFICATION_NEW' && msg.data?.title) {
          received.push(msg.data.title);
          if (received.length >= expected) {
            clearTimeout(timer);
            ws.off('message', onMessage);
            resolve(received);
          }
        }
      } catch {
        // bỏ qua message lạ
      }
    }

    ws.on('message', onMessage);
  });
}

async function main(): Promise<void> {
  const { prisma, pool } = createPrisma();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await redis.connect();
    await redis.ping();

    const { user, tenantId, tenantName } = await resolveTargetUser(prisma, targetArg);
    const actorName = user.name ?? user.email ?? 'User';
    const events = buildSampleEvents(user.id, tenantId, actorName);

    console.log('── Test notification realtime ─────────────────────────────');
    console.log(`  User  : ${user.email ?? user.id} (${user.id})`);
    console.log(`  Tenant: ${tenantName} (${tenantId})`);
    console.log(`  Số notification mẫu: ${events.length}`);
    console.log('');

    const kafkaEnabled = process.env.KAFKA_ENABLED === 'true';

    let ws: WebSocket | null = null;
    let selfTestPromise: Promise<string[]> | null = null;

    if (doSelfTest) {
      const token = jwt.sign(
        { userId: user.id, tokenVersion: user.tokenVersion },
        process.env.JWT_ACCESS_SECRET ?? '',
        { expiresIn: '5m' },
      );
      const port = process.env.NOTIFICATION_WS_PORT ?? '3001';
      const wsUrl = `ws://localhost:${port}/notifications?token=${token}`;
      try {
        ws = await connectWs(wsUrl);
        selfTestPromise = waitForNotifications(ws, events.length, SELF_TEST_TIMEOUT_MS);
        console.log('  [self-test] WebSocket kết nối OK, chờ nhận push realtime...');
      } catch (err) {
        console.warn(`  [self-test] Không mở được WS: ${(err as Error).message}`);
        console.warn('  → Notification vẫn được tạo trong DB nhưng không verify được realtime push.');
      }
      console.log('');
    }

    if (kafkaEnabled) {
      console.log('  Pipeline: outbox + Kafka (KAFKA_ENABLED=true)');
      for (const event of events) {
        await deliverViaKafka(prisma, event);
      }
    } else {
      console.log('  Pipeline: DB + Redis push (KAFKA_ENABLED=false)');
      console.log(`  → publish ${events.length} message lên Redis channel "${PUSH_CHANNEL}"`);
      for (const event of events) {
        await deliverDirect(prisma, redis, user.id, event);
      }
    }
    console.log('');

    for (const event of events) {
      console.log(`  ✓ ${EVENT_TYPE_TO_NOTIFICATION_TYPE[event.eventType]}: ${event.notification.title}`);
      console.log(`      → ${event.notification.body}`);
    }
    console.log('');

    if (doSelfTest && selfTestPromise) {
      const received = await selfTestPromise;
      console.log('── Kết quả realtime ───────────────────────────────────────');
      if (received.length === events.length) {
        console.log(`  ✅ Nhận đủ ${received.length}/${events.length} notification realtime qua WebSocket:`);
        for (const title of received) {
          console.log(`     - ${title}`);
        }
      } else {
        console.log(`  ⚠️  Chỉ nhận ${received.length}/${events.length} notification realtime (timeout ${SELF_TEST_TIMEOUT_MS}ms).`);
        console.log('     Kiểm tra: notification-ws service (port 3001) đang chạy?');
      }
      console.log('');
    }

    if (ws) {
      ws.close();
    }

    console.log('── Hướng dẫn kiểm tra frontend ─────────────────────────────');
    console.log('  WS endpoint backend: ws://<host>:3001/notifications?token=<JWT>');
    console.log('  REST              : http://<host>:3001/api/v1/notifications?limit=20');
    console.log('  → Nếu frontend dùng socket.io path "/socket.io/..." thì sẽ KHÔNG nhận được');
    console.log('    push này (backend dùng raw WebSocket ở path /notifications).');
    console.log('─────────────────────────────────────────────────────────────');
  } finally {
    await redis.quit().catch(() => undefined);
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Test notification thất bại:', err);
  process.exit(1);
});
