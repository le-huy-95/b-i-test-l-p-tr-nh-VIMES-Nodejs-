/**
 * Tầng nghiệp vụ thông báo: đọc list, unread, đánh dấu đã đọc, tạo từ Kafka event.
 *
 * Cache strategy:
 * - unread count: Redis TTL 300s, tăng dần khi tạo mới
 * - list "trang đầu" (limit=20, không filter): Redis TTL 60s
 * Invalidate khi mark-read / tạo mới.
 */
import type { Prisma, PrismaClient } from '../../../../src/infra/prisma-types';
import type { TenantNotificationEvent } from '../../../../src/shared/notifications/event-types';
import { EVENT_TYPE_TO_NOTIFICATION_TYPE } from '../../../../src/shared/notifications/event-types';
import { assertFound } from '../../../../src/utils/app-error';
import type { NotificationItem } from '../dto/notification.dto';
import type { ListNotificationsQuery, MarkReadInput } from '../dto/notification.dto';
import { RedisNotifCache } from '../infra/redis-notif-cache';

/**
 * Mã hóa cursor phân trang: { createdAt ISO, id } → base64url.
 * Client gửi lại cursor này để lấy trang tiếp theo (older than).
 */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');
}

/**
 * Giải mã cursor. Sai format / hỏng base64 → null (bỏ qua, lấy từ đầu).
 */
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt: string;
      id: string;
    };
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * Map row Prisma → DTO API/WS.
 * Date → ISO string; Json → object hoặc null.
 */
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
}): NotificationItem {
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

export class NotificationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly cache: RedisNotifCache,
  ) {}

  /** Expose mapper cho chỗ khác (nếu cần serialize cùng shape). */
  formatItem = toItem;

  /**
   * Số chưa đọc: cache hit thì trả luôn, miss thì COUNT DB rồi ghi cache.
   */
  async getUnreadCount(userId: string): Promise<number> {
    const cached = await this.cache.getUnreadCount(userId);
    if (cached != null) return cached;

    const count = await this.db.notification.count({
      where: { userId, readAt: null },
    });
    await this.cache.setUnreadCount(userId, count);
    return count;
  }

  /**
   * List theo cursor (createdAt DESC, id DESC).
   * Chỉ cache trang đầu mặc định (limit 20, không cursor/filter) vì các trang khác ít lặp lại.
   */
  async list(userId: string, query: ListNotificationsQuery) {
    const { limit, cursor, onlyUnread, tenantId } = query;
    // Điều kiện cache: đúng "inbox mặc định" trang 1
    const useCache = !cursor && !onlyUnread && !tenantId && limit === 20;

    if (useCache) {
      const cached = await this.cache.getLatestList<{ items: NotificationItem[]; nextCursor?: string }>(
        userId,
        limit,
      );
      if (cached) return cached;
    }

    const decoded = cursor ? decodeCursor(cursor) : null;
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(onlyUnread ? { readAt: null } : {}),
      ...(tenantId ? { tenantId } : {}),
      // Keyset pagination: lấy bản ghi "nhỏ hơn" cursor (cũ hơn)
      ...(decoded
        ? {
            OR: [
              { createdAt: { lt: decoded.createdAt } },
              { createdAt: decoded.createdAt, id: { lt: decoded.id } },
            ],
          }
        : {}),
    };

    const rows = await this.db.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // Lấy dư 1 dòng để biết còn trang sau không
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map(toItem);
    const nextCursor =
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
        : undefined;

    const result = { items, ...(nextCursor ? { nextCursor } : {}) };

    if (useCache) {
      await this.cache.setLatestList(userId, limit, result);
    }

    return result;
  }

  /**
   * Chi tiết 1 thông báo thuộc user.
   * Side-effect: nếu chưa đọc thì đánh dấu đã đọc + cập nhật unread cache.
   */
  async detail(userId: string, id: string): Promise<{ item: NotificationItem; unreadCount: number }> {
    const row = await this.db.notification.findFirst({ where: { userId, id } });
    const found = assertFound(row, 'Notification not found');
    const item = toItem(found);

    // Đã đọc rồi: không ghi DB, chỉ trả unread hiện tại
    if (found.readAt) {
      return { item, unreadCount: await this.getUnreadCount(userId) };
    }

    const now = new Date();
    // updateMany + điều kiện readAt:null tránh race khi 2 request cùng mở
    await this.db.notification.updateMany({
      where: { userId, id, readAt: null },
      data: { readAt: now },
    });

    const unreadCount = await this.db.notification.count({
      where: { userId, readAt: null },
    });
    await this.cache.setUnreadCount(userId, unreadCount);
    // Xóa list cache vì item đã đổi readAt
    await this.cache.invalidateUser(userId);

    return { item: { ...item, readAt: now.toISOString() }, unreadCount };
  }

  /**
   * Đánh dấu đã đọc hàng loạt.
   * - markAll=true: tất cả chưa đọc (có thể lọc tenantId)
   * - notificationIds: chỉ những id đó
   * - không markAll và không ids → no-op, trả unread hiện tại
   */
  async markRead(userId: string, input: MarkReadInput) {
    const now = new Date();
    const where: Prisma.NotificationWhereInput = {
      userId,
      readAt: null,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.notificationIds?.length ? { id: { in: input.notificationIds } } : {}),
    };

    if (!input.markAll && !input.notificationIds?.length) {
      return { updated: 0, unreadCount: await this.getUnreadCount(userId) };
    }

    const result = await this.db.notification.updateMany({
      where,
      data: { readAt: now },
    });

    const unreadCount = await this.db.notification.count({
      where: { userId, readAt: null },
    });
    await this.cache.setUnreadCount(userId, unreadCount);
    await this.cache.invalidateUser(userId);

    return { updated: result.count, unreadCount };
  }

  /**
   * Tạo Notification từ Kafka event cho 1 user.
   *
   * Idempotent theo unique (userId, eventId):
   * - Kafka at-least-once → có thể nhận trùng
   * - Đã tồn tại / race P2002 → trả null (không đẩy WS lần 2)
   *
   * @returns item + unreadCount để push realtime, hoặc null nếu skip
   */
  async createFromEvent(
    userId: string,
    event: TenantNotificationEvent,
  ): Promise<{ item: NotificationItem; unreadCount: number } | null> {
    const type = EVENT_TYPE_TO_NOTIFICATION_TYPE[event.eventType] as never;
    const eventKey = { userId_eventId: { userId, eventId: event.eventId } };

    // Kafka at-least-once: skip create when already persisted to avoid P2002 noise.
    const existing = await this.db.notification.findUnique({ where: eventKey });
    if (existing) {
      return null;
    }

    try {
      const row = await this.db.notification.create({
        data: {
          userId,
          tenantId: event.tenantId,
          type,
          title: event.notification.title,
          body: event.notification.body,
          data: event.data as Prisma.InputJsonValue | undefined,
          eventId: event.eventId,
          sourceType: event.source.type,
          sourceId: event.source.id,
          actorUserId: event.actorUserId,
          actorName: event.actorName,
          targetType: event.notification.targetType as never,
          targetId: event.notification.targetId,
          routeName: event.notification.routeName,
          routeParams: event.notification.routeParams as Prisma.InputJsonValue | undefined,
          deeplink: event.notification.deeplink,
        },
      });

      // Ưu tiên INCR cache; miss thì fallback COUNT DB
      const unreadCount = (await this.cache.incrementUnread(userId, 1)) ?? (await this.getUnreadCount(userId));
      await this.cache.invalidateUser(userId);

      return { item: toItem(row), unreadCount };
    } catch (err: unknown) {
      // Race with another worker on the same (userId, eventId).
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        return null;
      }
      throw err;
    }
  }
}
