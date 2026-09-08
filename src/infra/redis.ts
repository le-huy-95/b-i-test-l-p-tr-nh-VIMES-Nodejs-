/**
 * Quản lý kết nối Redis singleton cho toàn ứng dụng.
 *
 * Redis được dùng cho cache danh sách, cache quyền, pub/sub invalidation
 * và các tác vụ phụ trợ khác. Module này cấu hình client ioredis với
 * lazy connect, không queue lệnh khi offline, và cho phép ứng dụng tiếp tục
 * chạy khi Redis không khả dụng (getRedis() trả về null).
 */
import Redis, { type RedisOptions } from 'ioredis';
import { env } from '../config/env';

let redis: Redis | null = null;
let redisAvailable = false;

/**
 * Xây dựng cấu hình kết nối Redis từ biến môi trường.
 * Tắt retry vô hạn và offline queue để fail nhanh khi Redis down.
 */
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

/**
 * Lấy client Redis đang hoạt động, hoặc null nếu chưa kết nối / không khả dụng.
 */
export function getRedis(): Redis | null {
  if (!redisAvailable || !redis) return null;
  return redis;
}

/**
 * Kết nối tới Redis, ping kiểm tra, và đánh dấu sẵn sàng.
 * Ném lỗi nếu kết nối thất bại — caller quyết định có bắt buộc Redis hay không.
 */
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

/**
 * Đóng kết nối Redis gracefully khi shutdown ứng dụng.
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    redisAvailable = false;
    await redis.quit();
    redis = null;
    console.log('Redis connection closed');
  }
}
