-- CreateEnum
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('pending', 'processing', 'published', 'failed', 'dead_letter');

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_event_id_key" ON "notification_outbox"("event_id");

-- CreateIndex
CREATE INDEX "notification_outbox_status_available_at_idx" ON "notification_outbox"("status", "available_at");

-- CreateIndex
CREATE INDEX "notification_outbox_tenant_id_created_at_idx" ON "notification_outbox"("tenant_id", "created_at");
