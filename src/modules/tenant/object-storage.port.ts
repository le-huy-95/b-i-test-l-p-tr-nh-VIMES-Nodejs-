export interface ObjectStorage {
  uploadObject(key: string, body: Buffer, contentType: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
  objectKeyFromUrl(url: string): string | null;
}
