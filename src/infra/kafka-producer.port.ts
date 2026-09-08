/**
 * Port (interface) cho producer Kafka thông báo tenant.
 *
 * Tách abstraction khỏi implementation kafkajs để test dễ dàng và
 * có thể thay bằng NoOp khi KAFKA_ENABLED=false.
 */
import type { TenantNotificationEvent } from '../shared/notifications/event-types';

/** Hợp đồng publish sự kiện thông báo lên Kafka */
export interface KafkaProducerPort {
  publish(event: TenantNotificationEvent): Promise<void>;
}
