/**
 * Module xử lý lỗi ứng dụng tập trung.
 *
 * Cung cấp lớp AppError để biểu diễn lỗi nghiệp vụ có mã lỗi, HTTP status và chi tiết bổ sung,
 * cùng hàm assertFound để kiểm tra giá trị tồn tại trước khi tiếp tục xử lý.
 */

/* Lớp lỗi nghiệp vụ chuẩn — dùng trong service/controller để trả về phản hồi HTTP nhất quán */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Kiểm tra giá trị không null/undefined; nếu thiếu thì ném AppError 404.
 * Thường dùng sau truy vấn DB để đảm bảo bản ghi tồn tại trước khi cập nhật/xóa.
 */
export function assertFound<T>(
  value: T | null | undefined,
  message = "Not found",
): T {
  if (value == null) {
    throw new AppError("NOT_FOUND", 404, message);
  }
  return value;
}
