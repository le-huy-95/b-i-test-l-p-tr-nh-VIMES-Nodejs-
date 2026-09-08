/**
 * Định nghĩa kiểu dữ liệu cho module dịch vụ email.
 *
 * Các interface/type tại đây mô tả hợp đồng dữ liệu khi gửi email:
 * - Tùy chọn nội dung và người nhận (`SendEmailOptions`)
 * - Metadata ghi log (`EmailLogOptions`)
 * - Kết quả trả về sau khi xử lý (`EmailResult`)
 *
 * Không chứa logic nghiệp vụ — chỉ dùng cho type-checking và tài liệu API nội bộ.
 */

/** Loại email — chuỗi tự do, thường là 'otp', 'invite', 'password_reset', 'general', ... */
export type EmailType = string;

/**
 * Tùy chọn khi gửi một email.
 * Trường bắt buộc: người nhận (`to`), tiêu đề (`subject`), nội dung HTML (`html`).
 * Các trường `from`, `fromName`, `cc`, `bcc`, `replyTo` là tùy chọn — nếu bỏ qua
 * sẽ lấy giá trị mặc định từ biến môi trường.
 */
export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  fromName?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

/**
 * Metadata bổ sung khi ghi log email vào bảng `sendEmailLog`.
 * Dùng để phân loại email, liên kết user, và lưu dữ liệu mở rộng.
 */
export interface EmailLogOptions {
  emailType?: EmailType;
  templateName?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Kết quả trả về sau khi `EmailService.sendEmail` xử lý.
 * `success: true` khi log đã được tạo và dispatch thành công (hoặc skip dev).
 * `logId` là ID bản ghi trong DB để truy vết/trigger lại nếu cần.
 */
export interface EmailResult {
  success: boolean;
  message?: string;
  error?: string;
  logId?: string;
}
