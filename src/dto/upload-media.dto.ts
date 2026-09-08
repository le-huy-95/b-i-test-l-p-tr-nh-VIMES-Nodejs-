/**
 * Schema Zod và helper parse cho upload media.
 *
 * Validate trường kind (loại file) theo quy tắc media-types; ném AppError khi input không hợp lệ.
 */
import { z } from 'zod';
import { AppError } from '../utils/app-error';
import { KIND_PATTERN, MAX_KIND_LENGTH } from '../modules/file/media-types';

/* Schema query/body upload — kind chữ thường, giới hạn độ dài và ký tự cho phép */
export const uploadMediaSchema = z.object({
  kind: z
    .string()
    .trim()
    .toLowerCase()
    .max(MAX_KIND_LENGTH, 'Kind is too long')
    .regex(KIND_PATTERN, 'Kind can only contain letters, numbers, dash, underscore')
    .default('general'),
});

export type UploadMediaInput = z.infer<typeof uploadMediaSchema>;

/**
 * Parse và validate input upload đầy đủ.
 * Trả về UploadMediaInput hoặc ném VALIDATION_ERROR 400 kèm chi tiết lỗi Zod.
 */
export function parseUploadMediaInput(input: unknown): UploadMediaInput {
  const parsed = uploadMediaSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid request data', parsed.error.issues);
  }
  return parsed.data;
}

/**
 * Trích và validate riêng trường kind từ object bất kỳ.
 * Trả undefined nếu kind rỗng hoặc không phải chuỗi.
 */
export function parseUploadMediaKind(input: unknown): string | undefined {
  const raw = (input as Record<string, unknown> | null | undefined)?.kind;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  return parseUploadMediaInput({ kind: raw }).kind;
}
