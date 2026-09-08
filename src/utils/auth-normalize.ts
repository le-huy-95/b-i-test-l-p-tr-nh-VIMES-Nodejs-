/**
 * Chuẩn hóa dữ liệu đăng nhập/đăng ký trước khi lưu hoặc so khớp.
 *
 * Đảm bảo email và số điện thoại được xử lý nhất quán (trim, lowercase email)
 * để tránh trùng lặp do khoảng trắng hoặc chữ hoa/thường.
 */

/** Chuẩn hóa email: bỏ khoảng trắng đầu/cuối và chuyển về chữ thường */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Chuẩn hóa số điện thoại: chỉ bỏ khoảng trắng đầu/cuối, giữ nguyên định dạng số */
export function normalizePhone(phone: string): string {
  return phone.trim();
}
