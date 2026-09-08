/**
 * Điểm re-export công khai của module config.
 *
 * Các file khác có thể import từ `../config` thay vì `../config/env`
 * để lấy env, config và helper isSmtpConfigured — giữ API config gọn một chỗ.
 */
export { env, config, isSmtpConfigured } from './env';
