export type MediaCategory = 'image' | 'pdf' | 'media';

export const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/mpeg': '.mpeg',
  'video/ogg': '.ogv',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/flac': '.flac',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
};

export const ALLOWED_MEDIA_MIME_TYPES = Object.keys(MEDIA_EXTENSIONS);
export const MAX_MEDIA_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_KIND_LENGTH = 64;
export const KIND_PATTERN = /^[a-z0-9_-]+$/i;

export function extensionForMime(mimeType: string): string | null {
  return MEDIA_EXTENSIONS[mimeType] ?? null;
}

export function categoryForMime(mimeType: string): MediaCategory | null {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'media';
  return null;
}
