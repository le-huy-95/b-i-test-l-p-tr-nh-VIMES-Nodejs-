import type { NotificationItem, WsOutboundMessage } from '../dto/notification.dto';

export interface WsPeer {
  send(payload: string): void;
  isOpen(): boolean;
}

export class ConnectionManager {
  private readonly connections = new Map<string, Set<WsPeer>>();

  add(userId: string, peer: WsPeer): void {
    const set = this.connections.get(userId) ?? new Set<WsPeer>();
    set.add(peer);
    this.connections.set(userId, set);
  }

  remove(userId: string, peer: WsPeer): void {
    const set = this.connections.get(userId);
    if (!set) return;
    set.delete(peer);
    if (set.size === 0) {
      this.connections.delete(userId);
    }
  }

  hasUser(userId: string): boolean {
    const set = this.connections.get(userId);
    return !!set && set.size > 0;
  }

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

  pushNotification(userId: string, item: NotificationItem, unreadCount: number): void {
    this.push(userId, {
      type: 'NOTIFICATION_NEW',
      data: item,
      unreadCount,
    });
  }

  getOnlineUserIds(): string[] {
    return [...this.connections.keys()];
  }

  getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size ?? 0;
  }

  clearUser(userId: string): void {
    this.connections.delete(userId);
  }
}

export const connectionManager = new ConnectionManager();
