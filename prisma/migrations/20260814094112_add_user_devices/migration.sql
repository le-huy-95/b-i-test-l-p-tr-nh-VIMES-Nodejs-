-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('ios', 'android', 'web', 'other');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('active', 'inactive', 'deleted');

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "user_device_id" TEXT;

-- CreateTable
CREATE TABLE "user_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "device_type" "DeviceType" NOT NULL,
    "fcm_token" TEXT,
    "device_model" TEXT,
    "os_version" TEXT,
    "app_version" TEXT,
    "device_info" JSONB,
    "status" "DeviceStatus" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_device_id_key" ON "user_devices"("device_id");

-- CreateIndex
CREATE INDEX "user_devices_user_id_idx" ON "user_devices"("user_id");

-- CreateIndex
CREATE INDEX "user_devices_user_id_status_idx" ON "user_devices"("user_id", "status");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_device_id_idx" ON "refresh_tokens"("user_device_id");

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_device_id_fkey" FOREIGN KEY ("user_device_id") REFERENCES "user_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
