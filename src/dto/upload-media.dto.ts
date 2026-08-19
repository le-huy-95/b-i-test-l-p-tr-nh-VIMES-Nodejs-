import { z } from 'zod';
import { AppError } from '../utils/app-error';
import { KIND_PATTERN, MAX_KIND_LENGTH } from '../modules/file/media-types';

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

export function parseUploadMediaInput(input: unknown): UploadMediaInput {
  const parsed = uploadMediaSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid request data', parsed.error.issues);
  }
  return parsed.data;
}

export function parseUploadMediaKind(input: unknown): string | undefined {
  const raw = (input as Record<string, unknown> | null | undefined)?.kind;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  return parseUploadMediaInput({ kind: raw }).kind;
}
