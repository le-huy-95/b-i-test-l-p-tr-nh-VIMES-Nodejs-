/**
 * PORT LƯU TRỮ ĐỐI TƯỢNG (S3/MinIO)
 * ----------------------------------
 * Interface upload/xóa file logo tenant. Impl: infra/minio-storage.ts
 */
export interface ObjectStorage {
  uploadObject(key: string, body: Buffer, contentType: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
  objectKeyFromUrl(url: string): string | null;
}
