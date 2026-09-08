/**
 * DỊCH VỤ THIẾT BỊ NGƯỜI DÙNG
 * ---------------------------
 * Đăng ký/cập nhật thiết bị mobile (push notification, theo dõi phiên).
 * Upsert theo deviceId — mỗi thiết bị chỉ thuộc 1 user tại một thời điểm.
 */
import type { Prisma, PrismaClient } from '../../infra/prisma-types';
import { prisma } from '../../infra/prisma';
import { deviceSchema, registerDeviceSchema } from '../../dto/auth.dto';
import type { DeviceDto } from '../../dto/auth.dto';
import type { DeviceRegistry } from './device.port';

export class DeviceService implements DeviceRegistry {
  constructor(private readonly db: PrismaClient = prisma) {}

  async registerDevice(userId: string, input: unknown) {
    const data = registerDeviceSchema.parse(input);
    const existing = await this.db.userDevice.findUnique({
      where: { deviceId: data.deviceId },
    });
    const device = await this.upsertUserDevice(userId, data);
    return {
      device: this.formatDeviceResponse(device),
      isUpdate: !!existing,
    };
  }

  formatDeviceResponse(device: {
    id: string;
    deviceId: string;
    deviceType: string;
    deviceModel: string | null;
    osVersion: string | null;
    appVersion: string | null;
    status: string;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: device.id,
      deviceId: device.deviceId,
      deviceType: device.deviceType,
      deviceModel: device.deviceModel,
      osVersion: device.osVersion,
      appVersion: device.appVersion,
      status: device.status,
      lastLoginAt: device.lastLoginAt,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
    };
  }

  async upsertUserDevice(userId: string, device: DeviceDto) {
    const parsed = deviceSchema.parse(device);
    const now = new Date();

    const existing = await this.db.userDevice.findUnique({
      where: { deviceId: parsed.deviceId },
    });

    if (existing) {
      return this.db.userDevice.update({
        where: { id: existing.id },
        data: {
          userId,
          deviceType: parsed.deviceType,
          fcmToken: parsed.fcmToken,
          deviceModel: parsed.deviceModel,
          osVersion: parsed.osVersion,
          appVersion: parsed.appVersion,
          deviceInfo: parsed.deviceInfo as unknown as Prisma.InputJsonValue | undefined,
          status: 'active',
          lastLoginAt: now,
        },
      });
    }

    return this.db.userDevice.create({
      data: {
        userId,
        deviceId: parsed.deviceId,
        deviceType: parsed.deviceType,
        fcmToken: parsed.fcmToken,
        deviceModel: parsed.deviceModel,
        osVersion: parsed.osVersion,
        appVersion: parsed.appVersion,
        deviceInfo: parsed.deviceInfo as unknown as Prisma.InputJsonValue | undefined,
        status: 'active',
        lastLoginAt: now,
      },
    });
  }
}

export const deviceService = new DeviceService(prisma);
