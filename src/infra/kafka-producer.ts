/**
 * Producer Kafka gửi sự kiện thông báo tenant (notification-ws / downstream).
 *
 * Khi KAFKA_ENABLED=true: kết nối lazy, publish với partition key = tenantId,
 * retry với backoff khi lỗi. Khi tắt Kafka: export NoOpKafkaProducer không làm gì.
 */
import { Kafka, type Producer } from 'kafkajs';
import { env } from '../config/env';
import type { TenantNotificationEvent } from '../shared/notifications/event-types';
import type { KafkaProducerPort } from './kafka-producer.port';

/** Khoảng chờ giữa các lần retry publish (ms) */
const RETRY_DELAYS_MS = [200, 500, 1000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Implementation thật: kết nối Kafka producer và gửi message JSON lên topic notifications.
 */
class KafkaNotificationProducer implements KafkaProducerPort {
  private producer: Producer | null = null;
  private connecting: Promise<void> | null = null;

  /** Reset state khi mất kết nối để lần sau connect lại */
  private resetConnection(): void {
    this.producer = null;
    this.connecting = null;
  }

  /** Lazy connect producer; trả null nếu Kafka bị tắt */
  private async ensureConnected(): Promise<Producer | null> {
    if (env.KAFKA_ENABLED !== 'true') return null;
    if (this.producer) return this.producer;

    if (!this.connecting) {
      this.connecting = (async () => {
        const kafka = new Kafka({
          clientId: env.KAFKA_CLIENT_ID,
          brokers: env.KAFKA_BROKERS.split(',').map((b) => b.trim()),
        });
        this.producer = kafka.producer();
        await this.producer.connect();
      })().catch((err) => {
        this.resetConnection();
        throw err;
      });
    }

    await this.connecting;
    return this.producer;
  }

  /** Một lần gửi message — key theo tenantId để giữ thứ tự theo tenant */
  private async publishOnce(event: TenantNotificationEvent): Promise<void> {
    const producer = await this.ensureConnected();
    if (!producer) return;

    await producer.send({
      topic: env.KAFKA_TOPIC_NOTIFICATIONS,
      messages: [
        {
          key: event.tenantId,
          value: JSON.stringify(event),
        },
      ],
    });
  }

  /**
   * Publish với retry: reset connection và chờ backoff giữa các attempt.
   */
  async publish(event: TenantNotificationEvent): Promise<void> {
    if (env.KAFKA_ENABLED !== 'true') return;

    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await this.publishOnce(event);
        return;
      } catch (err) {
        lastError = err;
        this.resetConnection();
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
      }
    }

    console.error('[kafka-producer] publish failed after retries:', lastError);
    throw lastError;
  }
}

/** Stub khi Kafka tắt — publish là no-op */
class NoOpKafkaProducer implements KafkaProducerPort {
  async publish(): Promise<void> {
    // no-op
  }
}

/** Producer singleton: Kafka thật hoặc NoOp tùy env */
export const kafkaProducer: KafkaProducerPort =
  env.KAFKA_ENABLED === 'true' ? new KafkaNotificationProducer() : new NoOpKafkaProducer();
