import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);

vi.mock('kafkajs', () => ({
  Kafka: class MockKafka {
    producer() {
      return {
        connect: mockConnect,
        send: mockSend,
      };
    }
  },
}));

describe('kafka-producer', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockClear();
    mockConnect.mockClear();
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
    vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
    vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');
  });

  it('no-ops when KAFKA_ENABLED=false', async () => {
    vi.stubEnv('KAFKA_ENABLED', 'false');
    const { kafkaProducer } = await import('../../src/infra/kafka-producer');
    await kafkaProducer.publish({
      eventId: 'evt-1',
      eventType: 'RECEIPT_SUBMITTED',
      tenantId: 't1',
      actorUserId: 'u1',
      actorName: 'Alice',
      occurredAt: new Date().toISOString(),
      source: { type: 'stock_receipt', id: 'r1', code: 'PN-001' },
      recipientPolicy: { type: 'explicit_users', userIds: ['u2'] },
      notification: { title: 'Test', body: 'Body' },
    });
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('serializes payload when enabled', async () => {
    vi.stubEnv('KAFKA_ENABLED', 'true');
    vi.stubEnv('KAFKA_BROKERS', 'localhost:9094');
    vi.stubEnv('KAFKA_TOPIC_NOTIFICATIONS', 'tenant-notification-events');
    const { kafkaProducer } = await import('../../src/infra/kafka-producer');
    const event = {
      eventId: 'evt-2',
      eventType: 'RECEIPT_SUBMITTED' as const,
      tenantId: 't1',
      actorUserId: 'u1',
      actorName: 'Alice',
      occurredAt: new Date().toISOString(),
      source: { type: 'stock_receipt', id: 'r1', code: 'PN-001' },
      recipientPolicy: { type: 'explicit_users' as const, userIds: ['u2'] },
      notification: { title: 'Test', body: 'Body' },
    };
    await kafkaProducer.publish(event);
    expect(mockConnect).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'tenant-notification-events',
        messages: [expect.objectContaining({ key: 't1', value: JSON.stringify(event) })],
      }),
    );
  });
});
