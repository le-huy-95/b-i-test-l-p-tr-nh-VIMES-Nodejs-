/**
 * ĐIỂM KHỞI ĐỘNG SERVER (ENTRY POINT)
 * ------------------------------------
 * File này là nơi ứng dụng backend được khởi chạy. Nhiệm vụ chính:
 * 1. Kết nối PostgreSQL (Prisma) và Redis
 * 2. Khởi động các worker nền: notification outbox, stock mutation queue
 * 3. Dọn dẹp định kỳ bản ghi idempotency đã hết hạn
 * 4. Lắng nghe HTTP qua Express (app.ts) và xử lý tắt máy an toàn (graceful shutdown)
 *
 * List/report cache dùng lazy delete trên Redis shared — không cần stream consumer.
 */
import app from "./app";
import { clearLocalhostProxyEnv } from "./config/clear-localhost-proxy";
import { config, isSmtpConfigured } from "./config/env";
import { connectDatabase, closeDatabase } from "./infra/prisma";
import { connectRedis, closeRedis } from "./infra/redis";
import { getMailTransporter } from "./infra/smtp";
import { cleanupExpiredIdempotencyRecords } from "./middlewares/idempotency";
import { notificationOutboxWorker } from "./infra/notification-outbox-worker";
import {
  startStockMutationWorker,
  stopStockMutationWorker,
} from "./infra/stock-mutation-queue";

// Gỡ Clash/Surge localhost proxy trước khi mở kết nối ngoài (Google ID token / SMTP)
clearLocalhostProxyEnv();

// Timer dọn dẹp bản ghi idempotency hết hạn — chạy mỗi 1 giờ
let cleanupIdempotencyTimer: NodeJS.Timeout | null = null;

/** Bật job định kỳ xóa các khóa idempotency đã quá TTL trong DB */
function startIdempotencyCleanup(): void {
  cleanupIdempotencyTimer = setInterval(
    async () => {
      await cleanupExpiredIdempotencyRecords();
    },
    60 * 60 * 1000,
  );
  cleanupIdempotencyTimer.unref();
}

/**
 * Hàm bootstrap — khởi tạo toàn bộ hạ tầng trước khi mở cổng HTTP.
 * Thứ tự: DB → Redis (tùy chọn) → workers → HTTP server.
 */
async function bootstrap(): Promise<void> {
  try {
    // Bắt buộc: kết nối PostgreSQL qua Prisma
    await connectDatabase();
    // Redis không bắt buộc — nếu lỗi vẫn chạy được nhưng cache quyền dùng DB fallback
    try {
      await connectRedis();
    } catch (err) {
      console.warn(
        "Redis unavailable — permission/list cache will use DB fallback only:",
        err,
      );
    }

    // Worker gửi thông báo realtime (WebSocket/Kafka) từ outbox
    await notificationOutboxWorker.start();
    // Worker xử lý hàng đợi cập nhật tồn kho bất đồng bộ
    await startStockMutationWorker();
    startIdempotencyCleanup();

    // Kiểm tra SMTP sớm để cảnh báo nếu email OTP/invite không gửi được
    if (isSmtpConfigured()) {
      getMailTransporter()
        .then((t) => {
          if (!t)
            console.warn(
              "[SMTP] Configured but transporter unavailable — emails will fail",
            );
        })
        .catch((err) => console.warn("[SMTP] Warmup failed:", err));
    } else {
      console.warn("[SMTP] Not configured — OTP emails will not be delivered");
    }

    const server = app.listen(config.port, () => {
      console.log(`Server running on http://localhost:${config.port}`);
      console.log(`API base: http://localhost:${config.port}/api/v1`);
      console.log(`Environment: ${config.nodeEnv}`);
    });

    // Graceful shutdown: dừng workers → đóng HTTP → đóng Redis/DB
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      if (cleanupIdempotencyTimer) clearInterval(cleanupIdempotencyTimer);
      await notificationOutboxWorker.stop().catch(() => {});
      await stopStockMutationWorker().catch(() => {});
      server.close(async () => {
        await closeRedis();
        await closeDatabase();
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

bootstrap();
