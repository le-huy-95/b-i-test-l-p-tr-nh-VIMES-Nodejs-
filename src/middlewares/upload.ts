/**
 * Cấu hình upload file qua Multer (memory storage).
 *
 * Hai pipeline riêng:
 * - uploadTenantLogo: logo tenant (JPEG/PNG/WebP/GIF, giới hạn kích thước logo)
 * - uploadMediaFile: file media chung (mime được phép theo media-types, giới hạn 25MB)
 *
 * File lưu trong memory (buffer) — service phía sau upload lên MinIO.
 */
import multer from 'multer';
import { AppError } from '../utils/app-error';
import { ALLOWED_LOGO_MIME_TYPES, MAX_LOGO_SIZE_BYTES } from '../infra/minio-storage';
import { extensionForMime, MAX_MEDIA_SIZE_BYTES } from '../modules/file/media-types';

/**
 * Multer instance cho upload logo tenant — field name 'logo', tối đa 1 file.
 */
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_LOGO_MIME_TYPES.includes(file.mimetype)) {
      cb(new AppError('INVALID_LOGO_TYPE', 400, 'Logo must be JPEG, PNG, WebP, or GIF'));
      return;
    }
    cb(null, true);
  },
});

/** Middleware Express: nhận một file logo từ multipart form */
export const uploadTenantLogo = logoUpload.single('logo');

/**
 * Multer instance cho upload media (ảnh/tài liệu...) — field name 'file'.
 */
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MEDIA_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!extensionForMime(file.mimetype)) {
      cb(new AppError('INVALID_FILE_TYPE', 400, `Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

/** Middleware Express: nhận một file media từ multipart form */
export const uploadMediaFile = mediaUpload.single('file');
