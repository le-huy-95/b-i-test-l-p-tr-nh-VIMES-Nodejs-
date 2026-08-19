import { Kafka, type Producer } from 'kafkajs';
import { env } from '../config/env';
import type { TenantNotificationEvent } from '../shared/notifications/event-types';
import type { KafkaProducerPort } from './kafka-producer.port';

const RETRY_DELAYS_MS = [200, 500, 1000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class KafkaNotificationProducer implements KafkaProducerPort {
  private producer: Producer | null = null;
  private connecting: Promise<void> | null = null;

  private resetConnection(): void {
    this.producer = null;
    this.connecting = null;
  }

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

class NoOpKafkaProducer implements KafkaProducerPort {
  async publish(): Promise<void> {
    // no-op
  }
}

export const kafkaProducer: KafkaProducerPort =
  env.KAFKA_ENABLED === 'true' ? new KafkaNotificationProducer() : new NoOpKafkaProducer();
