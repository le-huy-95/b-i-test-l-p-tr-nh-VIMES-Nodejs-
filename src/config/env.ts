/**
 * Cấu hình biến môi trường (environment) cho toàn bộ ứng dụng backend.
 *
 * File này đọc biến từ process.env (qua dotenv), validate bằng Zod schema,
 * và export object `env` đã được type-safe. Mọi module khác nên import từ đây
 * thay vì đọc process.env trực tiếp — giúp phát hiện thiếu/sai cấu hình ngay
 * khi khởi động server thay vì lỗi runtime khó đoán.
 */
import dotenv from "dotenv";
import { z } from "zod";

// Nạp file .env vào process.env trước khi validate
dotenv.config();

/**
 * Schema Zod định nghĩa toàn bộ biến môi trường mà ứng dụng cần.
 * Mỗi field có default hoặc ràng buộc (min length, enum, url...) để đảm bảo
 * cấu hình hợp lệ trước khi server chạy.
 */
const envSchema = z.object({
  // --- Server cơ bản ---
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string().min(1),

  // --- JWT (access + refresh token) ---
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  // --- Redis (cache, permission, list cache...) ---
  REDIS_URL: z.string().default("redis://localhost:6380"),
  REDIS_PASSWORD: z.string().optional(),

  // --- MinIO / object storage ---
  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin"),
  MINIO_BUCKET: z.string().default("inventory"),
  MINIO_USE_SSL: z.enum(["true", "false"]).default("false"),
  /** URL công khai để client (mobile/web) load file. Bao gồm bucket, vd: https://storage.example.com/inventory */
  MINIO_PUBLIC_URL: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().url().optional(),
  ),

  // --- CORS & URL công khai của app ---
  APP_PUBLIC_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:5173"),

  // --- Email / SMTP ---
  DEFAULT_FROM_ADDRESS: z.email().default("info@yourdomain.com"),
  DEFAULT_FROM_NAME: z.string().default("Vimes"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().min(1).max(65535).optional().default(587),
  SMTP_SECURE: z.enum(["true", "false"]).optional().default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // --- OTP, invite, idempotency TTL ---
  OTP_EXPIRES_MINUTES: z.coerce.number().default(15),
  INVITE_EXPIRES_HOURS: z.coerce.number().default(72),

  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  // --- Facebook webhook ---
  FACEBOOK_WEBHOOK_VERIFY_TOKEN: z
    .string()
    .optional()
    .default("dev_facebook_verify_token"),

  // --- Firebase (đăng nhập Google / xác thực ID token) ---
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

  // --- Kafka (sự kiện thông báo realtime) ---
  KAFKA_BROKERS: z.string().default("localhost:9094"),
  KAFKA_CLIENT_ID: z.string().default("inventory-api"),
  KAFKA_TOPIC_NOTIFICATIONS: z.string().default("tenant-notification-events"),
  KAFKA_ENABLED: z.enum(["true", "false"]).default("true"),

  NOTIFICATION_WS_PORT: z.coerce.number().default(3001),

  // --- Outbox pattern (đẩy job/event bất đồng bộ) ---
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().default(5000),
  OUTBOX_BATCH_SIZE: z.coerce.number().default(20),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().default(10),
  OUTBOX_BASE_DELAY_MS: z.coerce.number().default(2000),
  OUTBOX_MAX_DELAY_MS: z.coerce.number().default(300000),
});

/** Kiểu TypeScript suy ra từ envSchema — dùng khi cần truyền config dạng typed */
export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Parse và validate process.env theo envSchema.
 * Ném lỗi ngay nếu thiếu biến bắt buộc hoặc sai định dạng — fail-fast khi boot.
 */
function loadEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    console.error("Environment validation failed:\n", errors.join("\n"));
    throw new Error(`Environment validation failed: ${errors.join(", ")}`);
  }
  return result.data;
}

/** Singleton cấu hình môi trường — import `env` ở mọi nơi cần biến env */
export const env = loadEnv();

/**
 * Kiểm tra SMTP đã cấu hình đủ (host + user + pass) để gửi email thật.
 * Nếu false, module email có thể skip hoặc dùng mock/log.
 */
export function isSmtpConfigured(): boolean {
  return !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

/** Tập con config thường dùng khi khởi tạo HTTP server */
export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
} as const;
