import type { TenantNotificationEvent } from '../shared/notifications/event-types';

export interface KafkaProducerPort {
  publish(event: TenantNotificationEvent): Promise<void>;
}
