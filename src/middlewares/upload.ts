import multer from 'multer';
import { AppError } from '../utils/app-error';
import { ALLOWED_LOGO_MIME_TYPES, MAX_LOGO_SIZE_BYTES } from '../infra/minio-storage';
import { extensionForMime, MAX_MEDIA_SIZE_BYTES } from '../modules/file/media-types';

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

export const uploadTenantLogo = logoUpload.single('logo');

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

export const uploadMediaFile = mediaUpload.single('file');
