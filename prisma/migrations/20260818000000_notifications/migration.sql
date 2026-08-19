-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('invitation_created', 'invitation_accepted', 'membership_removed', 'receipt_submitted', 'receipt_approved', 'receipt_rejected', 'receipt_completed', 'receipt_cancelled', 'issue_submitted', 'issue_approved', 'issue_rejected', 'issue_completed', 'issue_cancelled');

-- CreateEnum
CREATE TYPE "NotificationTargetType" AS ENUM ('tenant_invitation', 'tenant_list', 'stock_receipt', 'stock_issue', 'stock_movement');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "event_id" TEXT NOT NULL,
    "source_type" TEXT,
    "source_id" TEXT,
    "actor_user_id" TEXT,
    "actor_name" TEXT,
    "target_type" "NotificationTargetType",
    "target_id" TEXT,
    "route_name" TEXT,
    "route_params" JSONB,
    "deeplink" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_event_id_key" ON "notifications"("user_id", "event_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
