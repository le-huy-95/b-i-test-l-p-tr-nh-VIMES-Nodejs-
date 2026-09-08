/**
 * Registry in-memory: userId → tập socket đang mở trên process này.
 *
 * Một user có thể mở nhiều tab/device → Set<WsPeer>.
 * WsPeer là abstraction: WS thuần và Socket.IO cùng implement send/isOpen.
 *
 * Không persist: restart process là mất map (client phải reconnect).
 */
import type { NotificationItem, WsOutboundMessage } from '../dto/notification.dto';

/** Socket đã đăng ký: gửi payload string và báo còn sống hay không. */
export interface WsPeer {
  send(payload: string): void;
  isOpen(): boolean;
}

export class ConnectionManager {
  /** userId → các kết nối đang sống (WS + Socket.IO). */
  private readonly connections = new Map<string, Set<WsPeer>>();

  /** Đăng ký peer khi handshake thành công. */
  add(userId: string, peer: WsPeer): void {
    const set = this.connections.get(userId) ?? new Set<WsPeer>();
    set.add(peer);
    this.connections.set(userId, set);
  }

  /** Gỡ peer khi close/error/disconnect. Set rỗng thì xóa key user. */
  remove(userId: string, peer: WsPeer): void {
    const set = this.connections.get(userId);
    if (!set) return;
    set.delete(peer);
    if (set.size === 0) {
      this.connections.delete(userId);
    }
  }

  /** User còn ít nhất 1 socket mở trên process này không. */
  hasUser(userId: string): boolean {
    const set = this.connections.get(userId);
    return !!set && set.size > 0;
  }

  /**
   * Gửi message JSON tới mọi peer còn OPEN của user.
   * Peer chết / throw → xóa khỏi set (lazy cleanup).
   */
  push(userId: string, message: WsOutboundMessage): void {
    const set = this.connections.get(userId);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify(message);
    for (const peer of set) {
      if (peer.isOpen()) {
        try {
          peer.send(payload);
        } catch {
          set.delete(peer);
        }
      } else {
        set.delete(peer);
      }
    }
    if (set.size === 0) {
      this.connections.delete(userId);
    }
  }

  /** Helper: đóng gói NOTIFICATION_NEW rồi push. */
  pushNotification(userId: string, item: NotificationItem, unreadCount: number): void {
    this.push(userId, {
      type: 'NOTIFICATION_NEW',
      data: item,
      unreadCount,
    });
  }

  /** Danh sách user đang online (có socket) trên instance này. */
  getOnlineUserIds(): string[] {
    return [...this.connections.keys()];
  }

  /** Số tab/device đang kết nối của 1 user (debug / metrics). */
  getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size ?? 0;
  }

  /** Đá toàn bộ socket map của user (không đóng TCP — chỉ quên peer). */
  clearUser(userId: string): void {
    this.connections.delete(userId);
  }
}

/** Singleton dùng chung WS thuần, Socket.IO, và push-relay. */
export const connectionManager = new ConnectionManager();
