import app from './app';
import { config, isSmtpConfigured } from './config/env';
import { connectDatabase, closeDatabase } from './infra/prisma';
import { connectRedis, closeRedis } from './infra/redis';
import { getMailTransporter } from './infra/smtp';
import { createCacheInvalidationConsumer } from './infra/redis-streams';
import { cacheInvalidationService } from './infra/cache-invalidation';
import { cleanupExpiredIdempotencyRecords } from './middlewares/idempotency';
import { notificationOutboxWorker } from './infra/notification-outbox-worker';
import { startStockMutationWorker, stopStockMutationWorker } from './infra/stock-mutation-queue';

let cleanupIdempotencyTimer: NodeJS.Timeout | null = null;

function startIdempotencyCleanup(): void {
  cleanupIdempotencyTimer = setInterval(async () => {
    await cleanupExpiredIdempotencyRecords();
  }, 60 * 60 * 1000);
  cleanupIdempotencyTimer.unref();
}

async function bootstrap(): Promise<void> {
  let consumer: ReturnType<typeof createCacheInvalidationConsumer> | null = null;

  try {
    await connectDatabase();
    try {
      await connectRedis();
    } catch (err) {
      console.warn('Redis unavailable — permission cache will use DB fallback only:', err);
    }

    consumer = createCacheInvalidationConsumer(
      `cache-invalidator-${process.pid}`,
      async (event) => {
        if (event.group === 'master') {
          await cacheInvalidationService.invalidateMasterData(event.tenantId);
          return;
        }
        if (event.group === 'stock-documents') {
          await cacheInvalidationService.invalidateStockDocuments(event.tenantId);
          return;
        }
        if (event.group === 'stock-reads' || event.group === 'stock-mutations') {
          await cacheInvalidationService.invalidateStockReads(event.tenantId);
          return;
        }
        if (event.group === 'all') {
          await cacheInvalidationService.invalidateAllTenantReadCaches(event.tenantId);
        }
      },
      (err) => console.error('[cache-stream]', err),
    );
    await consumer.start();
    await notificationOutboxWorker.start();
    await startStockMutationWorker();
    startIdempotencyCleanup();

    if (isSmtpConfigured()) {
      getMailTransporter()
        .then((t) => {
          if (!t) console.warn('[SMTP] Configured but transporter unavailable — emails will fail');
        })
        .catch((err) => console.warn('[SMTP] Warmup failed:', err));
    } else {
      console.warn('[SMTP] Not configured — OTP emails will not be delivered');
    }

    const server = app.listen(config.port, () => {
      console.log(`Server running on http://localhost:${config.port}`);
      console.log(`API base: http://localhost:${config.port}/api/v1`);
      console.log(`Environment: ${config.nodeEnv}`);
    });

    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      if (cleanupIdempotencyTimer) clearInterval(cleanupIdempotencyTimer);
      await notificationOutboxWorker.stop().catch(() => {});
      await stopStockMutationWorker().catch(() => {});
      await consumer?.stop().catch(() => {});
      server.close(async () => {
        await closeRedis();
        await closeDatabase();
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();
