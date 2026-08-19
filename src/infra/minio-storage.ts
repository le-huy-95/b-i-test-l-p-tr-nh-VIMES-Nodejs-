import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../config/env';
import type { ObjectStorage } from '../modules/tenant/object-storage.port';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const ALLOWED_LOGO_MIME_TYPES = Object.keys(MIME_TO_EXT);
export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

function minioEndpoint(): string {
  const protocol = env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
  return `${protocol}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`;
}

function publicBaseUrl(): string {
  return `${minioEndpoint()}/${env.MINIO_BUCKET}`;
}

export class MinioObjectStorage implements ObjectStorage {
  private client: S3Client | null = null;
  private bucketReady: Promise<void> | null = null;

  private getClient(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        endpoint: minioEndpoint(),
        region: 'us-east-1',
        credentials: {
          accessKeyId: env.MINIO_ACCESS_KEY,
          secretAccessKey: env.MINIO_SECRET_KEY,
        },
        forcePathStyle: true,
      });
    }
    return this.client;
  }

  private async ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const client = this.getClient();
        try {
          await client.send(new HeadBucketCommand({ Bucket: env.MINIO_BUCKET }));
        } catch {
          await client.send(new CreateBucketCommand({ Bucket: env.MINIO_BUCKET }));
        }

        await client.send(
          new PutBucketPolicyCommand({
            Bucket: env.MINIO_BUCKET,
            Policy: JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: '*',
                  Action: ['s3:GetObject'],
                  Resource: [`arn:aws:s3:::${env.MINIO_BUCKET}/*`],
                },
              ],
            }),
          }),
        );
      })();
    }
    await this.bucketReady;
  }

  async uploadObject(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.ensureBucket();
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: env.MINIO_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return `${publicBaseUrl()}/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    await this.ensureBucket();
    await this.getClient().send(
      new DeleteObjectCommand({
        Bucket: env.MINIO_BUCKET,
        Key: key,
      }),
    );
  }

  objectKeyFromUrl(url: string): string | null {
    const prefix = `${publicBaseUrl()}/`;
    if (!url.startsWith(prefix)) return null;
    return url.slice(prefix.length);
  }
}

export function logoExtensionForMime(mimeType: string): string | null {
  return MIME_TO_EXT[mimeType] ?? null;
}

export function tenantLogoObjectKey(tenantId: string, extension: string): string {
  return `tenants/${tenantId}/logo${extension}`;
}

export const objectStorage = new MinioObjectStorage();
