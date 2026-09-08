/**
 * Hàm tiện ích hỗ trợ module dịch vụ email.
 *
 * Tập hợp các helper nhỏ, không phụ thuộc vào Prisma hay nodemailer:
 * - Lấy giá trị mặc định từ env (tên site, URL, địa chỉ gửi)
 * - Chuẩn hóa mảng địa chỉ email
 * - Bổ sung biến chung cho template Handlebars (siteName, siteUrl, currentYear)
 * - Ánh xạ mã vai trò tenant sang nhãn tiếng Việt hiển thị trong email
 */

import { env } from '../../config/env';

/** Lấy tên hiển thị mặc định của ứng dụng (dùng trong tiêu đề/subject email) */
export function getDefaultSiteName(): string {
  return env.DEFAULT_FROM_NAME;
}

/** Lấy URL công khai của ứng dụng (dùng trong link trong template email) */
export function getDefaultSiteUrl(): string {
  return env.APP_PUBLIC_URL;
}

/** Lấy địa chỉ email gửi mặc định từ cấu hình env */
export function getDefaultFromAddress(): string {
  return env.DEFAULT_FROM_ADDRESS;
}

/**
 * Chuẩn hóa tham số người nhận thành mảng chuỗi.
 * Nodemailer và Prisma log đều lưu `to` dạng mảng — hàm này thống nhất đầu vào.
 */
export function normalizeEmailArray(email: string | string[]): string[] {
  return Array.isArray(email) ? email : [email];
}

/**
 * Bổ sung biến mặc định cho dữ liệu template Handlebars.
 * Merge `data` đầu vào với siteName, siteUrl, currentYear nếu chưa có.
 */
export function createTemplateData(data: Record<string, unknown>): Record<string, unknown> {
  return {
    ...data,
    siteName: (data.siteName as string) || getDefaultSiteName(),
    siteUrl: (data.siteUrl as string) || getDefaultSiteUrl(),
    currentYear: new Date().getFullYear(),
  };
}

/** Ghép danh sách email thành chuỗi phân cách bằng dấu phẩy (dùng trong message log) */
export function formatEmailList(emails: string[]): string {
  return emails.join(', ');
}

/** Bảng ánh xạ mã vai trò tenant → nhãn tiếng Việt hiển thị trong email mời */
const TENANT_ROLE_LABELS: Record<string, string> = {
  admin: 'Quản trị viên',
  warehouse_keeper: 'Thủ kho',
  accountant: 'Kế toán',
  staff: 'Nhân viên',
};

/**
 * Chuyển mã vai trò tenant (ví dụ 'admin') sang nhãn tiếng Việt.
 * Nếu không có trong bảng ánh xạ, trả về nguyên mã gốc.
 */
export function tenantRoleLabel(role: string): string {
  return TENANT_ROLE_LABELS[role] ?? role;
}
