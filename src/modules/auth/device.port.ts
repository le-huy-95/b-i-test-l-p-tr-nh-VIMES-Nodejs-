/**
 * PORT ĐĂNG KÝ THIẾT BỊ
 * ---------------------
 * Interface mô tả kết quả đăng ký thiết bị và contract DeviceRegistry.
 * Cho phép mock trong test hoặc thay implementation.
 */
export interface RegisteredDevice {
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
}

export interface RegisterDeviceResult {
  device: RegisteredDevice;
  isUpdate: boolean;
}

export interface DeviceRegistry {
  registerDevice(userId: string, input: unknown): Promise<RegisterDeviceResult>;
}