import Redis, { type RedisOptions } from 'ioredis';
import { env } from '../config/env';

let redis: Redis | null = null;
let redisAvailable = false;

function buildRedisOptions(): RedisOptions {
  const options: RedisOptions = {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  };

  if (env.REDIS_PASSWORD) {
    options.password = env.REDIS_PASSWORD;
  }

  return options;
}

export function getRedis(): Redis | null {
  if (!redisAvailable || !redis) return null;
  return redis;
}

export async function connectRedis(): Promise<void> {
  const client = new Redis(env.REDIS_URL, buildRedisOptions());

  client.on('error', (err) => {
    if (redisAvailable) {
      console.warn('[redis]', err.message);
    }
  });

  try {
    await client.connect();
    await client.ping();
    redis = client;
    redisAvailable = true;
    console.log('Redis connected');
  } catch (err) {
    client.removeAllListeners();
    client.disconnect();
    redis = null;
    redisAvailable = false;
    throw err;
  }
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    redisAvailable = false;
    await redis.quit();
    redis = null;
    console.log('Redis connection closed');
  }
}
