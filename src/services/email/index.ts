/**
 * Điểm vào (barrel export) của module dịch vụ email.
 *
 * Module này tập trung xuất các thành phần công khai của hệ thống gửi email:
 * - Handler gửi email liên quan xác thực (OTP, mời tham gia, đặt lại mật khẩu)
 * - Singleton `emailService` dùng chung trong toàn ứng dụng
 * - Lớp `EmailService` để khởi tạo instance tùy chỉnh (ví dụ trong test)
 * - Các kiểu dữ liệu (types) cho tùy chọn gửi email và kết quả trả về
 * - Hàm kiểm tra cấu hình SMTP từ biến môi trường
 *
 * Các module khác nên import từ file này thay vì import trực tiếp từ file con.
 */

// Handler email xác thực: OTP đăng nhập, lời mời tenant, OTP đặt lại mật khẩu
export * from "./handlers/auth.handlers";

// Instance singleton EmailService đã gắn sẵn Prisma client
export { emailService } from "./instance";

// Lớp EmailService — dùng khi cần inject Prisma client riêng
export { EmailService } from "./EmailService.class";

// Kiểu dữ liệu: SendEmailOptions, EmailLogOptions, EmailResult, ...
export type * from "./types";

// Kiểm tra SMTP đã được cấu hình trong env hay chưa
export { isSmtpConfigured } from "../../config/env";
