# Notification WS + Kafka Light Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách nhẹ notification realtime: Business API publish Kafka event; service `notification-ws` (process riêng, cùng repo) consume event, ghi DB, cache Redis, push WebSocket; Flutter dùng API inbox + WS (không FCM phase 1).

**Architecture:** Giữ `src/` là Business API (port 3000). Thêm `services/notification-ws/` chạy port 3001: REST `/api/v1/notifications/*` + WebSocket `/notifications`. Chung PostgreSQL, Redis, JWT secret. Kafka topic `tenant-notification-events`. Business API chỉ publish sau DB commit; mọi xử lý nặng ở WS service.

**Tech Stack:** Node.js, Express, TypeScript, Prisma, Redis (ioredis), Kafka (kafkajs), ws, Vitest

**Phạm vi phase 1:**
- Event: invitation created/accepted, receipt/issue submit/approve/reject/complete
- Không FCM, không multi-instance WS, không stock ledger line events
- Có `actorName`, `routeName`, `routeParams`, `deeplink` trong notification

---

## File map

| File | Trách nhiệm |
|------|-------------|
| `prisma/schema.prisma` | Model `Notification`, enums |
| `src/shared/notifications/event-types.ts` | Kafka payload types, eventType constants |
| `src/shared/notifications/recipient-policy.ts` | Zod schema recipient policy |
| `src/infra/kafka-producer.ts` | Publish event (Business API) |
| `src/infra/kafka-producer.port.ts` | Interface cho test/mock |
| `services/notification-ws/src/index.ts` | Bootstrap HTTP + WS + consumer |
| `services/notification-ws/src/config/env.ts` | Env WS service |
| `services/notification-ws/src/kafka/consumer.ts` | Consume topic |
| `services/notification-ws/src/ws/server.ts` | WebSocket server |
| `services/notification-ws/src/ws/auth.ts` | Verify JWT từ query/header |
| `services/notification-ws/src/ws/connection-manager.ts` | Map userId → connections |
| `services/notification-ws/src/modules/notification.service.ts` | Create notification, mark read |
| `services/notification-ws/src/modules/recipient.resolver.ts` | Resolve userIds từ policy |
| `services/notification-ws/src/modules/notification.routes.ts` | REST inbox API |
| `services/notification-ws/src/infra/redis-notif-cache.ts` | unread + list cache |
| `src/modules/tenant/tenant.service.ts` | Publish sau invite/accept |
| `src/modules/stock-receipt/stock-receipt.service.ts` | Publish lifecycle events |
| `src/modules/stock-issue/stock-issue.service.ts` | Publish lifecycle events |
| `docker-compose.yml` | Optional: kafka + notification-ws service |
| `.env.example` | Kafka + WS env vars |
| `docs/NOTIFICATION_WS.md` | Contract API + WS cho Flutter |

---

## Task 1: Prisma — bảng notifications

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260817200000_notifications/migration.sql`

- [ ] **Step 1: Thêm enums và model**

```prisma
enum NotificationType {
  invitation_created
  invitation_accepted
  membership_removed
  receipt_submitted
  receipt_approved
  receipt_rejected
  receipt_completed
  receipt_cancelled
  issue_submitted
  issue_approved
  issue_rejected
  issue_completed
  issue_cancelled
}

enum NotificationTargetType {
  tenant_invitation
  tenant_list
  stock_receipt
  stock_issue
  stock_movement
}

model Notification {
  id          String                  @id @default(cuid())
  userId      String                  @map("user_id")
  tenantId    String?                 @map("tenant_id")
  type        NotificationType
  title       String
  body        String
  data        Json?
  eventId     String                  @map("event_id")
  sourceType  String?                 @map("source_type")
  sourceId    String?                 @map("source_id")
  actorUserId String?                 @map("actor_user_id")
  actorName   String?                 @map("actor_name")
  targetType  NotificationTargetType? @map("target_type")
  targetId    String?                 @map("target_id")
  routeName   String?                 @map("route_name")
  routeParams Json?                   @map("route_params")
  deeplink    String?
  readAt      DateTime?               @map("read_at")
  createdAt   DateTime                @default(now()) @map("created_at")

  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([userId, eventId])
  @@index([userId, readAt, createdAt(sort: Desc)])
  @@map("notifications")
}
```

Thêm relation `notifications Notification[]` vào `User` và `Tenant`.

- [ ] **Step 2: Migration**

```bash
npm run db:migrate
```

Expected: migration applied, `notifications` table exists.

- [ ] **Step 3: Regenerate client**

```bash
npm run db:generate
```

---

## Task 2: Shared Kafka event contract + producer (Business API)

**Files:**
- Create: `src/shared/notifications/event-types.ts`
- Create: `src/shared/notifications/recipient-policy.ts`
- Create: `src/infra/kafka-producer.port.ts`
- Create: `src/infra/kafka-producer.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `package.json` (add `kafkajs`)

- [ ] **Step 1: Install kafkajs**

```bash
bun add kafkajs
```

- [ ] **Step 2: Env vars**

Thêm vào `src/config/env.ts`:

```typescript
KAFKA_BROKERS: z.string().default('localhost:9094'),
KAFKA_CLIENT_ID: z.string().default('inventory-api'),
KAFKA_TOPIC_NOTIFICATIONS: z.string().default('tenant-notification-events'),
KAFKA_ENABLED: z.enum(['true', 'false']).default('true'),
```

`.env.example`:

```env
KAFKA_BROKERS=localhost:9094
KAFKA_CLIENT_ID=inventory-api
KAFKA_TOPIC_NOTIFICATIONS=tenant-notification-events
KAFKA_ENABLED=true
```

- [ ] **Step 3: Event types**

`src/shared/notifications/event-types.ts`:

```typescript
export const NOTIFICATION_EVENT_TYPES = {
  INVITATION_CREATED: 'INVITATION_CREATED',
  INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
  MEMBERSHIP_REMOVED: 'MEMBERSHIP_REMOVED',
  RECEIPT_SUBMITTED: 'RECEIPT_SUBMITTED',
  RECEIPT_APPROVED: 'RECEIPT_APPROVED',
  RECEIPT_REJECTED: 'RECEIPT_REJECTED',
  RECEIPT_COMPLETED: 'RECEIPT_COMPLETED',
  RECEIPT_CANCELLED: 'RECEIPT_CANCELLED',
  ISSUE_SUBMITTED: 'ISSUE_SUBMITTED',
  ISSUE_APPROVED: 'ISSUE_APPROVED',
  ISSUE_REJECTED: 'ISSUE_REJECTED',
  ISSUE_COMPLETED: 'ISSUE_COMPLETED',
  ISSUE_CANCELLED: 'ISSUE_CANCELLED',
} as const;

export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[keyof typeof NOTIFICATION_EVENT_TYPES];

export interface TenantNotificationEvent {
  eventId: string;
  eventType: NotificationEventType;
  tenantId: string;
  actorUserId: string;
  actorName: string;
  occurredAt: string;
  source: { type: string; id: string; code?: string };
  recipientPolicy: RecipientPolicy;
  notification: {
    title: string;
    body: string;
    targetType?: string;
    targetId?: string;
    routeName?: string;
    routeParams?: Record<string, string>;
    deeplink?: string;
  };
  data?: Record<string, unknown>;
}
```

- [ ] **Step 4: Kafka producer**

`src/infra/kafka-producer.ts` — connect lazy, `publishNotificationEvent(event)` fire-and-forget, log error không throw (tránh làm fail API). Nếu `KAFKA_ENABLED=false` → no-op.

- [ ] **Step 5: Test producer mock**

Create: `tests/infra/kafka-producer.test.ts` — verify no-op when disabled, serialize payload when enabled (mock Kafka).

```bash
npm run test tests/infra/kafka-producer.test.ts
```

Expected: PASS

---

## Task 3: Notification WS service skeleton

**Files:**
- Create: `services/notification-ws/tsconfig.json`
- Create: `services/notification-ws/src/index.ts`
- Create: `services/notification-ws/src/config/env.ts`
- Create: `services/notification-ws/src/app.ts`
- Modify: `package.json` scripts

- [ ] **Step 1: Install ws + concurrently**

```bash
bun add ws
bun add -d @types/ws concurrently
```

- [ ] **Step 2: tsconfig**

`services/notification-ws/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "../../dist/notification-ws",
    "baseUrl": ".",
    "paths": {
      "@api/*": ["../../src/*"]
    }
  },
  "include": ["src/**/*", "../../src/infra/prisma.ts", "../../src/generated/prisma/**/*"]
}
```

Phase 1: import prisma trực tiếp từ `../../src/infra/prisma`.

- [ ] **Step 3: Scripts**

```json
"dev:ws": "tsx watch services/notification-ws/src/index.ts",
"start:ws": "node dist/notification-ws/index.js",
"dev:all": "concurrently \"npm run dev\" \"npm run dev:ws\""
```

- [ ] **Step 4: Bootstrap**

`services/notification-ws/src/index.ts`:
- load env
- connect DB + Redis
- start HTTP (port `NOTIFICATION_WS_PORT` default 3001)
- mount routes `/api/v1/notifications`
- attach WebSocket on path `/notifications`
- start Kafka consumer

- [ ] **Step 5: Health check**

`GET /health` → `{ status: 'ok', service: 'notification-ws' }`

Run:

```bash
npm run dev:ws
curl http://localhost:3001/health
```

Expected: 200 OK

---

## Task 4: Redis notification cache

**Files:**
- Create: `services/notification-ws/src/infra/redis-notif-cache.ts`

- [ ] **Step 1: Implement cache**

Keys:
- `notif:unread:{userId}` — number
- `notif:list:{userId}:latest:{limit}` — JSON, TTL 60s

Methods:
- `getUnreadCount(userId)`
- `setUnreadCount(userId, count)`
- `incrementUnread(userId, delta)`
- `getLatestList(userId, limit)`
- `setLatestList(userId, limit, data)`
- `invalidateUser(userId)` — xóa list cache

- [ ] **Step 2: Test**

Create: `tests/services/notification-ws/redis-notif-cache.test.ts` (mock Redis)

---

## Task 5: Notification REST API (WS service)

**Files:**
- Create: `services/notification-ws/src/dto/notification.dto.ts`
- Create: `services/notification-ws/src/modules/notification.service.ts`
- Create: `services/notification-ws/src/modules/notification.controller.ts`
- Create: `services/notification-ws/src/modules/notification.routes.ts`
- Create: `services/notification-ws/src/middlewares/auth.ts` (copy pattern từ `src/middlewares/auth.ts`)

- [ ] **Step 1: DTO**

```typescript
// list query
limit: z.coerce.number().min(1).max(50).default(20),
cursor: z.string().optional(),
onlyUnread: z.coerce.boolean().optional().default(false),
tenantId: z.string().optional(),

// mark read
notificationIds: z.array(z.string()).optional(),
markAll: z.boolean().optional(),
```

- [ ] **Step 2: Endpoints**

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/v1/notifications/unread-count` | Badge |
| GET | `/api/v1/notifications` | List cursor pagination |
| POST | `/api/v1/notifications/mark-read` | Mark read |

Auth: `Authorization: Bearer` — cùng JWT secret.

- [ ] **Step 3: List logic**

- Sort: `createdAt desc`
- Cursor: encode `{ createdAt, id }` base64
- Cache trang đầu (`cursor` absent, `limit=20`) qua Redis
- Response shape giống plan trước (items + nextCursor)

- [ ] **Step 4: Mark read**

- Update `readAt`
- Recount unread → set Redis
- Invalidate list cache

- [ ] **Step 5: Test service**

Create: `tests/services/notification-ws/notification.service.test.ts`

```bash
npm run test tests/services/notification-ws/notification.service.test.ts
```

Expected: PASS

---

## Task 6: Kafka consumer + recipient resolver

**Files:**
- Create: `services/notification-ws/src/kafka/consumer.ts`
- Create: `services/notification-ws/src/modules/recipient.resolver.ts`
- Modify: `services/notification-ws/src/modules/notification.service.ts`

- [ ] **Step 1: Recipient resolver**

Policies phase 1:

```typescript
type RecipientPolicy =
  | { type: 'explicit_users'; userIds: string[] }
  | { type: 'tenant_roles'; roles: TenantRole[] }
  | { type: 'source_creator'; createdByUserId: string };
```

Implement:
- `explicit_users` → return userIds
- `tenant_roles` → query `user_tenants` where tenantId + role in roles + isActive
- `source_creator` → return [createdByUserId]

Special: `INVITATION_CREATED` — Business API nên gửi `explicit_users` nếu resolve được userId từ email; nếu chưa có user → skip notification (chỉ email invite như hiện tại).

- [ ] **Step 2: Consumer flow**

For each Kafka message:
1. Parse + validate với Zod
2. Resolve recipients
3. For each recipient (dedupe):
   - `upsert` notification (`userId + eventId` unique)
   - `incrementUnread`
   - `invalidateUser` list cache
   - `connectionManager.push(userId, payload)`

Idempotency: duplicate eventId per user → skip insert, vẫn có thể push WS (optional).

- [ ] **Step 3: Map eventType → NotificationType enum**

Ví dụ: `RECEIPT_APPROVED` → `receipt_approved`

- [ ] **Step 4: Test resolver + consumer handler**

Create: `tests/services/notification-ws/recipient.resolver.test.ts`

---

## Task 7: WebSocket server

**Files:**
- Create: `services/notification-ws/src/ws/auth.ts`
- Create: `services/notification-ws/src/ws/connection-manager.ts`
- Create: `services/notification-ws/src/ws/server.ts`

- [ ] **Step 1: Auth**

Connect URL:

```text
ws://localhost:3001/notifications?token=<accessToken>
```

Verify JWT với `JWT_ACCESS_SECRET`, extract `userId` (sub).

- [ ] **Step 2: Connection manager**

```typescript
class ConnectionManager {
  add(userId: string, ws: WebSocket): void;
  remove(userId: string, ws: WebSocket): void;
  push(userId: string, message: WsOutboundMessage): void;
}
```

Support nhiều tab/device cùng user.

- [ ] **Step 3: Outbound message**

```typescript
interface WsOutboundMessage {
  type: 'NOTIFICATION_NEW' | 'PONG';
  data?: NotificationItem;
  unreadCount?: number;
}
```

- [ ] **Step 4: Heartbeat**

Client gửi `{ "type": "PING" }` mỗi 30s → server `{ "type": "PONG" }`.
Server ping idle connections, close zombie sau 60s.

- [ ] **Step 5: Manual test**

1. Login lấy token
2. Connect wscat: `wscat -c "ws://localhost:3001/notifications?token=..."`
3. Trigger invite event → nhận `NOTIFICATION_NEW`

---

## Task 8: Hook Business API publish events

**Files:**
- Modify: `src/modules/tenant/tenant.service.ts`
- Modify: `src/modules/stock-receipt/stock-receipt.service.ts`
- Modify: `src/modules/stock-issue/stock-issue.service.ts`
- Modify: `src/modules/stock-receipt/stock-receipt.controller.ts` (pass actor name/id nếu cần)
- Modify: `src/modules/stock-issue/stock-issue.controller.ts`
- Modify: `src/modules/tenant/tenant.controller.ts`

- [ ] **Step 1: Helper publish**

Create: `src/shared/notifications/publish.ts`:

```typescript
export async function publishTenantNotification(
  event: Omit<TenantNotificationEvent, 'eventId' | 'occurredAt'>,
): Promise<void> {
  await kafkaProducer.publish({
    ...event,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: tenant.service.ts**

Sau `invite()` success:

```typescript
await publishTenantNotification({
  eventType: NOTIFICATION_EVENT_TYPES.INVITATION_CREATED,
  tenantId,
  actorUserId: inviterId,
  actorName: inviter.name ?? inviter.email ?? 'Admin',
  source: { type: 'invitation', id: invitation.id },
  recipientPolicy: { type: 'explicit_users', userIds: resolvedInviteeUserIds },
  notification: {
    title: 'Lời mời tham gia tổ chức',
    body: `${actorName} đã mời bạn vào ${tenant.name}`,
    targetType: 'tenant_invitation',
    targetId: invitation.id,
    routeName: 'tenant_invitation_detail',
    routeParams: { invitationId: invitation.id, tenantId },
    deeplink: `myapp://tenant-invitations/${invitation.id}`,
  },
});
```

Sau `acceptInvite()` → notify admin (tenant_roles: admin) event `INVITATION_ACCEPTED`.

- [ ] **Step 3: stock-receipt.service.ts**

Sau mỗi transition thành công (submit/approve/reject/complete/cancel), publish event tương ứng.

Recipient gợi ý:
- submit → `tenant_roles: ['admin','approver','accountant']`
- approve/reject → `source_creator`
- complete → `source_creator` + optional admin

Body luôn có tên actor: `"${actorName} đã duyệt phiếu ${code}"`.

- [ ] **Step 4: stock-issue.service.ts**

Tương tự receipt.

- [ ] **Step 5: Controller pass actor**

Controllers đã có `req.user` — truyền `userId`, `name` vào service methods hoặc publish ngay trong service bằng cách load user.

- [ ] **Step 6: Integration test (optional phase 1)**

Publish mock → verify không throw khi Kafka down (API vẫn 200).

---

## Task 9: Docker, env, docs

**Files:**
- Modify: `docker-compose.yml` (optional kafka service)
- Create: `docker-compose.kafka.yml` (optional)
- Create: `docs/NOTIFICATION_WS.md`
- Modify: `docs/API.md` (link tới NOTIFICATION_WS.md)

- [ ] **Step 1: Kafka local**

Nếu chưa có Kafka trong compose project, thêm `docker-compose.kafka.yml` hoặc document dùng Kafka sẵn có `localhost:9094`.

- [ ] **Step 2: docker-compose service notification-ws**

```yaml
notification-ws:
  build: .
  command: npm run start:ws
  ports:
    - '3001:3001'
  env_file: .env
  depends_on:
    - postgres
    - redis
```

- [ ] **Step 3: docs/NOTIFICATION_WS.md**

Document:
- Architecture diagram
- REST endpoints
- WS protocol
- Flutter flow (login → unread-count → connect WS → bottomSheet)
- Cache behavior
- Event types phase 1

- [ ] **Step 4: Update PUSH_NOTIFICATION_FLUTTER.md**

Ghi chú: phase notification realtime dùng WS, FCM tạm hoãn.

---

## Task 10: Verification checklist

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 2: Tests**

```bash
npm run test
```

- [ ] **Step 3: E2E manual**

1. `npm run dev:all`
2. Login 2 user (admin + invitee)
3. Admin invite → invitee WS nhận event + unread tăng
4. Invitee mở bottomSheet → list có item
5. Mark read → unread = 0
6. Submit phiếu nhập → approver nhận WS

- [ ] **Step 4: Performance smoke**

- Submit phiếu response time không tăng đáng kể (< +5ms) khi Kafka enabled
- 50 WS connections local — CPU ổn định

---

## Flutter integration (reference, không code backend)

| Thời điểm | Action |
|-----------|--------|
| Sau login | `GET {notifBase}/notifications/unread-count` |
| Sau login | Connect `ws://host:3001/notifications?token=...` |
| Nhận WS | Update badge, `dirty=true` |
| Mở bottomSheet lần đầu | `GET {notifBase}/notifications?limit=20` |
| Mở lại | Dùng cache nếu không dirty |
| App resume | Reconnect WS + sync unread-count |

Env Flutter:

```dart
const notifApiBase = 'http://localhost:3001/api/v1';
const wsUrl = 'ws://localhost:3001/notifications';
```

---

## Anti-patterns (tránh)

1. ❌ Ghi notification + push WS đồng bộ trong Business API request
2. ❌ Publish Kafka trước khi DB commit
3. ❌ Bắn event cho từng stock ledger line
4. ❌ Badge chỉ tin WS, không sync API unread-count
5. ❌ Không có `eventId` unique → duplicate notification

---

## Timeline ước lượng

| Task | Thời gian |
|------|-----------|
| 1 Prisma | 0.5 ngày |
| 2 Kafka producer | 0.5 ngày |
| 3 WS skeleton | 0.5 ngày |
| 4 Redis cache | 0.5 ngày |
| 5 REST API | 1 ngày |
| 6 Consumer + resolver | 1 ngày |
| 7 WebSocket | 0.5 ngày |
| 8 Business hooks | 1 ngày |
| 9 Docker + docs | 0.5 ngày |
| 10 Verification | 0.5 ngày |
| **Tổng** | **~6–7 ngày** |

---

## Self-review

| Requirement | Task |
|-------------|------|
| Tách nhẹ 2 process | Task 3, 9 |
| Kafka event invitation + phiếu | Task 2, 8 |
| WS push realtime | Task 7 |
| Inbox API + pagination | Task 5 |
| Redis cache unread + list | Task 4 |
| actorName trong notification | Task 8 |
| routeName/deeplink | Task 1, 5, 8 |
| Không FCM phase 1 | Scope |
| Hiệu năng API không bị block | Task 2 fire-and-forget, Anti-patterns |
