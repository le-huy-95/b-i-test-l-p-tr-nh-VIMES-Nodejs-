import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  REDIS_URL: z.string().default('redis://localhost:6380'),
  REDIS_PASSWORD: z.string().optional(),

  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET: z.string().default('inventory'),
  MINIO_USE_SSL: z.enum(['true', 'false']).default('false'),
  /** URL công khai để client (mobile/web) load file. Bao gồm bucket, vd: https://storage.example.com/inventory */
  MINIO_PUBLIC_URL: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().url().optional(),
  ),

  APP_PUBLIC_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),

  DEFAULT_FROM_ADDRESS: z.email().default('info@yourdomain.com'),
  DEFAULT_FROM_NAME: z.string().default('Vimes'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().min(1).max(65535).optional().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).optional().default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  OTP_EXPIRES_MINUTES: z.coerce.number().default(15),
  INVITE_EXPIRES_HOURS: z.coerce.number().default(72),

  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  FACEBOOK_WEBHOOK_VERIFY_TOKEN: z.string().optional().default('dev_facebook_verify_token'),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

  KAFKA_BROKERS: z.string().default('localhost:9094'),
  KAFKA_CLIENT_ID: z.string().default('inventory-api'),
  KAFKA_TOPIC_NOTIFICATIONS: z.string().default('tenant-notification-events'),
  KAFKA_ENABLED: z.enum(['true', 'false']).default('true'),

  NOTIFICATION_WS_PORT: z.coerce.number().default(3001),

  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().default(5000),
  OUTBOX_BATCH_SIZE: z.coerce.number().default(20),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().default(10),
  OUTBOX_BASE_DELAY_MS: z.coerce.number().default(2000),
  OUTBOX_MAX_DELAY_MS: z.coerce.number().default(300000),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    console.error('Environment validation failed:\n', errors.join('\n'));
    throw new Error(`Environment validation failed: ${errors.join(', ')}`);
  }
  return result.data;
}

export const env = loadEnv();

export function isSmtpConfigured(): boolean {
  return !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
} as const;
