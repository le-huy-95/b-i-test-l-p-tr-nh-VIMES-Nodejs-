/**
 * DỊCH VỤ FILE
 * ------------
 * Upload lên MinIO, lưu metadata DB, trả presigned URL cho client tải/xem.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import { AppError } from "../../utils/app-error";
import { objectStorage } from "../../infra/minio-storage";
import type { ObjectStorage } from "../tenant/object-storage.port";
import { paginate, paginationSchema } from "../../dto/pagination.dto";
import {
  extensionForMime,
  KIND_PATTERN,
  MAX_KIND_LENGTH,
  MAX_MEDIA_SIZE_BYTES,
} from "./media-types";
import type { TenantRole } from "../../infra/prisma-types";

const fileListSchema = paginationSchema.extend({
  kind: z
    .string()
    .trim()
    .toLowerCase()
    .max(MAX_KIND_LENGTH, "Kind is too long")
    .regex(
      KIND_PATTERN,
      "Kind can only contain letters, numbers, dash, underscore",
    )
    .optional(),
});

export interface UploadFileInput {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

export interface UploadedFileDto {
  id: string;
  tenantId: string;
  uploadedById: string;
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
  kind: string;
  createdAt: Date;
}

function toDto(row: {
  id: string;
  tenantId: string;
  uploadedById: string;
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
  kind: string;
  createdAt: Date;
}): UploadedFileDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    uploadedById: row.uploadedById,
    url: row.url,
    originalName: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    kind: row.kind,
    createdAt: row.createdAt,
  };
}

export class FileService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly storage: ObjectStorage = objectStorage,
  ) {}

  async uploadFile(
    tenantId: string,
    uploadedById: string,
    file: UploadFileInput,
    kind = "general",
  ): Promise<UploadedFileDto> {
    const extension = extensionForMime(file.mimetype);
    if (!extension) {
      throw new AppError(
        "INVALID_FILE_TYPE",
        400,
        `Unsupported file type: ${file.mimetype}`,
      );
    }
    if (file.size <= 0) {
      throw new AppError("EMPTY_FILE", 400, "File is empty");
    }
    if (file.size > MAX_MEDIA_SIZE_BYTES) {
      throw new AppError("FILE_TOO_LARGE", 400, "File must be 25MB or smaller");
    }

    const objectKey = `media/${tenantId}/${kind}/${randomUUID()}${extension}`;
    const url = await this.storage.uploadObject(
      objectKey,
      file.buffer,
      file.mimetype,
    );

    const record = await this.db.uploadedFile.create({
      data: {
        tenantId,
        uploadedById,
        objectKey,
        url,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        kind,
      },
    });

    return toDto(record);
  }

  async getFile(id: string, tenantId: string): Promise<UploadedFileDto> {
    const record = await this.db.uploadedFile.findFirst({
      where: { id, tenantId },
    });
    if (!record) throw new AppError("NOT_FOUND", 404, "File not found");
    return toDto(record);
  }

  async listFiles(tenantId: string, query?: unknown) {
    const params =
      query && Object.keys(query as object).length > 0
        ? fileListSchema.parse(query)
        : null;

    const where: Prisma.UploadedFileWhereInput = {
      tenantId,
      ...(params?.kind ? { kind: params.kind } : {}),
      ...(params?.search?.trim()
        ? {
            originalName: {
              contains: params.search.trim(),
              mode: "insensitive",
            },
          }
        : {}),
    };

    if (!params) {
      const data = await this.db.uploadedFile.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });
      return data.map(toDto);
    }

    const { page, limit } = params;
    const [data, total] = await Promise.all([
      this.db.uploadedFile.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.uploadedFile.count({ where }),
    ]);

    return paginate(data.map(toDto), page, limit, total);
  }

  async replaceFile(
    id: string,
    tenantId: string,
    actor: { userId: string; role: TenantRole },
    file: UploadFileInput,
    kind?: string,
  ): Promise<UploadedFileDto> {
    const existing = await this.db.uploadedFile.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new AppError("NOT_FOUND", 404, "File not found");
    if (actor.role !== "admin" && existing.uploadedById !== actor.userId) {
      throw new AppError(
        "FORBIDDEN",
        403,
        "Only the uploader or an admin can update this file",
      );
    }

    const extension = extensionForMime(file.mimetype);
    if (!extension) {
      throw new AppError(
        "INVALID_FILE_TYPE",
        400,
        `Unsupported file type: ${file.mimetype}`,
      );
    }
    if (file.size <= 0) throw new AppError("EMPTY_FILE", 400, "File is empty");
    if (file.size > MAX_MEDIA_SIZE_BYTES) {
      throw new AppError("FILE_TOO_LARGE", 400, "File must be 25MB or smaller");
    }

    const nextKind = kind ?? existing.kind;
    const objectKey = `media/${tenantId}/${nextKind}/${randomUUID()}${extension}`;
    const url = await this.storage.uploadObject(
      objectKey,
      file.buffer,
      file.mimetype,
    );

    try {
      const updated = await this.db.uploadedFile.update({
        where: { id: existing.id },
        data: {
          objectKey,
          url,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          kind: nextKind,
        },
      });
      await this.storage
        .deleteObject(existing.objectKey)
        .catch(() => undefined);
      return toDto(updated);
    } catch (error) {
      await this.storage.deleteObject(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async deleteFile(
    id: string,
    tenantId: string,
    actor: { userId: string; role: TenantRole },
  ): Promise<{ id: string }> {
    const record = await this.db.uploadedFile.findFirst({
      where: { id, tenantId },
    });
    if (!record) throw new AppError("NOT_FOUND", 404, "File not found");

    if (actor.role !== "admin" && record.uploadedById !== actor.userId) {
      throw new AppError(
        "FORBIDDEN",
        403,
        "Only the uploader or an admin can delete this file",
      );
    }

    await this.storage.deleteObject(record.objectKey).catch(() => undefined);
    await this.db.uploadedFile.delete({ where: { id: record.id } });

    return { id: record.id };
  }
}

export const fileService = new FileService(prisma, objectStorage);
