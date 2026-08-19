import Redis from 'ioredis';
import { env } from '../config/env';
import { getRedis } from './redis';

const CACHE_INVALIDATION_STREAM = 'cache:invalidate';
const CACHE_INVALIDATION_GROUP = 'cache-invalidators';
const MAX_STREAM_LENGTH = 10_000;
const BLOCK_MS = 5_000;
const BATCH_SIZE = 100;
const PENDING_IDLE_MS = 30_000;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 5_000;

type StreamFields = string[];
type StreamEntry = [string, StreamFields];
type XAutoClaimReply = [string, StreamEntry[], string[]?];
type XReadGroupReply = Array<[string, StreamEntry[]]>;

export interface CacheInvalidationEvent {
  tenantId: string;
  group: string;
  timestamp: number;
}

function buildStreamClient(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, RETRY_MAX_MS),
    // Only reconnect on connection-level Redis errors (e.g. replica READONLY).
    // Returning true for every error (including BUSYGROUP) forces a reconnect mid-startup
    // and breaks the next command when enableOfflineQueue is false.
    reconnectOnError: (err) => err.message.includes('READONLY'),
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  });
}

function parseEvent(fields: StreamFields): CacheInvalidationEvent | null {
  const payloadIndex = fields.indexOf('data');
  if (payloadIndex === -1 || !fields[payloadIndex + 1]) return null;
  try {
    return JSON.parse(fields[payloadIndex + 1]) as CacheInvalidationEvent;
  } catch {
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishCacheInvalidation(
  tenantId: string,
  group: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const event: CacheInvalidationEvent = {
    tenantId,
    group,
    timestamp: Date.now(),
  };

  try {
    await redis.xadd(
      CACHE_INVALIDATION_STREAM,
      'MAXLEN',
      '~',
      MAX_STREAM_LENGTH,
      '*',
      'data',
      JSON.stringify(event),
    );
  } catch (err) {
    console.error('[Stream] publish failed:', err);
  }
}

export interface StreamConsumerOptions {
  consumerName: string;
  onMessage: (event: CacheInvalidationEvent) => Promise<void>;
  onError?: (err: Error) => void;
}

export class CacheInvalidationStreamConsumer {
  private readonly redis: Redis;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(private readonly options: StreamConsumerOptions) {
    this.redis = buildStreamClient();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.connectWithBackoff();
      await this.ensureGroup();
      await this.replayPending();
      this.loopPromise = this.poll().catch((err) => {
        this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    } catch (err) {
      this.running = false;
      this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise.catch(() => {});
    }
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  private async connectWithBackoff(): Promise<void> {
    let delay = RETRY_BASE_MS;
    while (this.running) {
      try {
        if (this.redis.status !== 'ready') {
          await this.redis.connect();
        }
        await this.redis.ping();
        return;
      } catch (err) {
        this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
        await sleep(delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      }
    }
  }

  private async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', CACHE_INVALIDATION_STREAM, CACHE_INVALIDATION_GROUP, '$', 'MKSTREAM');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('BUSYGROUP')) {
        throw err;
      }
    }
  }

  private async replayPending(): Promise<void> {
    let startId = '0-0';

    while (this.running) {
      const reply = (await this.redis.xautoclaim(
        CACHE_INVALIDATION_STREAM,
        CACHE_INVALIDATION_GROUP,
        this.options.consumerName,
        PENDING_IDLE_MS,
        startId,
        'COUNT',
        BATCH_SIZE,
      )) as XAutoClaimReply;

      const [nextStartId, entries] = reply;
      if (!entries.length) break;

      for (const [id, fields] of entries) {
        await this.handleMessage(id, fields);
      }

      if (!nextStartId || nextStartId === '0-0') {
        break;
      }
      startId = nextStartId;
    }
  }

  private async poll(): Promise<void> {
    let delay = RETRY_BASE_MS;

    while (this.running) {
      try {
        const reply = (await this.redis.xreadgroup(
          'GROUP',
          CACHE_INVALIDATION_GROUP,
          this.options.consumerName,
          'COUNT',
          BATCH_SIZE,
          'BLOCK',
          BLOCK_MS,
          'STREAMS',
          CACHE_INVALIDATION_STREAM,
          '>',
        )) as XReadGroupReply | null;

        if (!reply) continue;

        for (const [, entries] of reply) {
          for (const [id, fields] of entries) {
            await this.handleMessage(id, fields);
          }
        }

        delay = RETRY_BASE_MS;
      } catch (err) {
        this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
        await sleep(delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      }
    }
  }

  private async handleMessage(id: string, fields: StreamFields): Promise<void> {
    const event = parseEvent(fields);
    if (!event) {
      await this.redis.xack(CACHE_INVALIDATION_STREAM, CACHE_INVALIDATION_GROUP, id);
      return;
    }

    try {
      await this.options.onMessage(event);
      await this.redis.xack(CACHE_INVALIDATION_STREAM, CACHE_INVALIDATION_GROUP, id);
    } catch (err) {
      this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

export function createCacheInvalidationConsumer(
  consumerName: string,
  onMessage: (event: CacheInvalidationEvent) => Promise<void>,
  onError?: (err: Error) => void,
): CacheInvalidationStreamConsumer {
  return new CacheInvalidationStreamConsumer({ consumerName, onMessage, onError });
}
