import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  uploadedFile: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    uploadObject: vi.fn(),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    objectKeyFromUrl: vi.fn(),
  },
}));

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/infra/minio-storage', () => ({
  objectStorage: mockStorage,
}));

describe('file service', () => {
  beforeEach(() => {
    for (const fn of Object.values(mockPrisma.uploadedFile)) {
      fn.mockReset();
    }
    mockStorage.uploadObject.mockReset();
    mockStorage.deleteObject.mockReset();
    mockStorage.objectKeyFromUrl.mockReset();
    mockStorage.deleteObject.mockResolvedValue(undefined);
  });

  it('uploads a PDF and records metadata', async () => {
    mockStorage.uploadObject.mockResolvedValue('http://localhost:9000/inventory/media/t1/general/file.pdf');
    mockPrisma.uploadedFile.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'file-1',
        tenantId: 'tenant-1',
        uploadedById: 'user-1',
        objectKey: data.objectKey,
        url: data.url,
        originalName: data.originalName,
        mimeType: data.mimeType,
        size: data.size,
        kind: data.kind,
        createdAt: new Date('2026-08-19T10:00:00.000Z'),
      }),
    );

    const { fileService } = await import('../../src/modules/file/file.service');
    const result = await fileService.uploadFile('tenant-1', 'user-1', {
      buffer: Buffer.from('%PDF-1.7'),
      mimetype: 'application/pdf',
      size: 8,
      originalname: 'report.pdf',
    }, 'document');

    expect(mockStorage.uploadObject).toHaveBeenCalledWith(
      expect.stringMatching(/^media\/tenant-1\/document\/[0-9a-f-]+\.pdf$/),
      expect.any(Buffer),
      'application/pdf',
    );
    expect(mockPrisma.uploadedFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        uploadedById: 'user-1',
        kind: 'document',
        originalName: 'report.pdf',
        mimeType: 'application/pdf',
        size: 8,
      }),
    });
    expect(result).toMatchObject({
      id: 'file-1',
      url: expect.stringContaining('/media/t1/general/file.pdf'),
      kind: 'document',
    });
  });

  it('rejects an unsupported file type', async () => {
    const { fileService } = await import('../../src/modules/file/file.service');
    await expect(
      fileService.uploadFile('tenant-1', 'user-1', {
        buffer: Buffer.from('x'),
        mimetype: 'text/html',
        size: 1,
        originalname: 'page.html',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
    expect(mockStorage.uploadObject).not.toHaveBeenCalled();
  });

  it('gets a file scoped to the tenant', async () => {
    mockPrisma.uploadedFile.findFirst.mockResolvedValue({
      id: 'file-1',
      tenantId: 'tenant-1',
      uploadedById: 'user-1',
      objectKey: 'media/tenant-1/general/a.png',
      url: 'http://localhost:9000/inventory/media/tenant-1/general/a.png',
      originalName: 'a.png',
      mimeType: 'image/png',
      size: 10,
      kind: 'general',
      createdAt: new Date('2026-08-19T10:00:00.000Z'),
    });

    const { fileService } = await import('../../src/modules/file/file.service');
    const result = await fileService.getFile('file-1', 'tenant-1');

    expect(result.id).toBe('file-1');
    expect(mockPrisma.uploadedFile.findFirst).toHaveBeenCalledWith({
      where: { id: 'file-1', tenantId: 'tenant-1' },
    });
  });

  it('returns NOT_FOUND when the file belongs to another tenant', async () => {
    mockPrisma.uploadedFile.findFirst.mockResolvedValue(null);

    const { fileService } = await import('../../src/modules/file/file.service');
    await expect(fileService.getFile('file-1', 'tenant-2')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lists files with pagination and kind filter', async () => {
    mockPrisma.uploadedFile.findMany.mockResolvedValue([
      {
        id: 'file-1',
        tenantId: 'tenant-1',
        uploadedById: 'user-1',
        objectKey: 'media/tenant-1/image/a.jpg',
        url: 'http://localhost:9000/inventory/media/tenant-1/image/a.jpg',
        originalName: 'a.jpg',
        mimeType: 'image/jpeg',
        size: 10,
        kind: 'image',
        createdAt: new Date('2026-08-19T10:00:00.000Z'),
      },
    ]);
    mockPrisma.uploadedFile.count.mockResolvedValue(1);

    const { fileService } = await import('../../src/modules/file/file.service');
    const result = await fileService.listFiles('tenant-1', { page: '1', limit: '20', kind: 'image' });

    expect(mockPrisma.uploadedFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1', kind: 'image' } }),
    );
    expect(result).toMatchObject({
      data: [{ id: 'file-1' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it('replaces a file the uploader owns and deletes the old object', async () => {
    mockPrisma.uploadedFile.findFirst.mockResolvedValue({
      id: 'file-1',
      tenantId: 'tenant-1',
      uploadedById: 'user-1',
      objectKey: 'media/tenant-1/document/old.pdf',
      url: 'http://localhost:9000/inventory/media/tenant-1/document/old.pdf',
      originalName: 'old.pdf',
      mimeType: 'application/pdf',
      size: 8,
      kind: 'document',
      createdAt: new Date('2026-08-19T10:00:00.000Z'),
    });
    mockStorage.uploadObject.mockResolvedValue('http://localhost:9000/inventory/media/tenant-1/document/new.pdf');
    mockPrisma.uploadedFile.update.mockResolvedValue({
      id: 'file-1',
      tenantId: 'tenant-1',
      uploadedById: 'user-1',
      objectKey: 'media/tenant-1/document/new.pdf',
      url: 'http://localhost:9000/inventory/media/tenant-1/document/new.pdf',
      originalName: 'new.pdf',
      mimeType: 'application/pdf',
      size: 12,
      kind: 'document',
      createdAt: new Date('2026-08-19T10:00:00.000Z'),
    });

    const { fileService } = await import('../../src/modules/file/file.service');
    const result = await fileService.replaceFile(
      'file-1',
      'tenant-1',
      { userId: 'user-1', role: 'staff' },
      { buffer: Buffer.from('%PDF-1.7'), mimetype: 'application/pdf', size: 12, originalname: 'new.pdf' },
    );

    expect(mockStorage.uploadObject).toHaveBeenCalledWith(
      expect.stringMatching(/^media\/tenant-1\/document\/[0-9a-f-]+\.pdf$/),
      expect.any(Buffer),
      'application/pdf',
    );
    expect(mockPrisma.uploadedFile.update).toHaveBeenCalledWith({
      where: { id: 'file-1' },
      data: expect.objectContaining({ kind: 'document', originalName: 'new.pdf', size: 12 }),
    });
    expect(mockStorage.deleteObject).toHaveBeenCalledWith('media/tenant-1/document/old.pdf');
    expect(result.originalName).toBe('new.pdf');
  });

  it('lets an admin replace a file uploaded by someone else', async () => {
    mockPrisma.uploadedFile.findFirst.mockResolvedValue({
      id: 'file-1',
      tenantId: 'tenant-1',
      uploadedById: 'user-2',
      objectKey: 'media/tenant-1/image/a.jpg',
      url: 'http://localhost:9000/inventory/media/tenant-1/image/a.jpg',
      originalName: 'a.jpg',
      mimeType: 'image/jpeg',
      size: 10,
      kind: 'image',
      createdAt: new Date('2026-08-19T10:00:00.000Z'),
    });
    mockStorage.uploadObject.mockResolvedValue('http://localhost:9000/inventory/media/tenant-1/image/b.jpg');
    mockPrisma.uploadedFile.update.mockResolvedValue({ id: 'file-1' });

    const { fileService } = await import('../../src/modules/file/file.service');
    await expect(
      fileService.replaceFile(
        'file-1',
        'tenant-1',
        { userId: 'admin-1', role: 'admin' },
        { buffer: Buffer.from('jpg'), mimetype: 'image/jpeg', size: 11, originalname: 'b.jpg' },
      ),
    ).resolves.toBeDefined();
    expect(mockStorage.deleteObject).toHaveBeenCalledWith('media/tenant-1/image/a.jpg');
  });

  it('forbids a non-admin from replacing someone else file', async () => {
    mockPrisma.uploadedFile.findFirst.mockResolvedValue({
      id: 'file-1',
      tenantId: 'tenant-1',
      uploadedById: 'user-2',
      objectKey: 'media/tenant-1/image/a.jpg',
      url: 'http://localhost:9000/inventory/media/tenant-1/image/a.jpg',
      originalName: 'a.jpg',
      mimeType: 'image/jpeg',
      size: 10,
      kind: 'image',
      createdAt: new Date('2026-08-19T10:00:00.000Z'),
    });

    const { fileService } = await import('../../src/modules/file/file.service');
    await expect(
      fileService.replaceFile(
        'file-1',
        'tenant-1',
        { userId: 'user-3', role: 'staff' },
        { buffer: Buffer.from('jpg'), mimetype: 'image/jpeg', size: 11, originalname: 'b.jpg' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockStorage.uploadObject).not.toHaveBeenCalled();
  });

  it('lets the uploader delete their own file', async () => {
    mockPrisma.uploadedFile.findFirst.mockResolvedValue({
      id: 'file-1',
      tenantId: 'tenant-1',
      uploadedById: 'user-1',
      objectKey: 'media/tenant-1/general/a.png',
      url: 'http://localhost:9000/inventory/media/tenant-1/general/a.png',
      originalName: 'a.png',
      mimeType: 'image/png',
      size: 10,
      kind: 'general',
      createdAt: new Date('2026-08-19T10:00:00.000Z'),
    });
    mockPrisma.uploadedFile.delete.mockResolvedValue({ id: 'file-1' });

    const { fileService } = await import('../../src/modules/file/file.service');
    const result = await fileService.deleteFile('file-1', 'tenant-1', {
      userId: 'user-1',
      role: 'staff',
    });

    expect(mockStorage.deleteObject).toHaveBeenCalledWith('media/tenant-1/general/a.png');
    expect(mockPrisma.uploadedFile.delete).toHaveBeenCalledWith({ where: { id: 'file-1' } });
    expect(result).toEqual({ id: 'file-1' });
  });

  it('lets an admin delete any file in the tenant', async () => {
    mockPrisma.uploadedFile.findFirst.mockResolvedValue({
      id: 'file-1',
      tenantId: 'tenant-1',
      uploadedById: 'user-2',
      objectKey: 'media/tenant-1/general/a.png',
      url: 'http://localhost:9000/inventory/media/tenant-1/general/a.png',
      originalName: 'a.png',
      mimeType: 'image/png',
      size: 10,
      kind: 'general',
      createdAt: new Date('2026-08-19T10:00:00.000Z'),
    });
    mockPrisma.uploadedFile.delete.mockResolvedValue({ id: 'file-1' });

    const { fileService } = await import('../../src/modules/file/file.service');
    await expect(
      fileService.deleteFile('file-1', 'tenant-1', { userId: 'admin-1', role: 'admin' }),
    ).resolves.toEqual({ id: 'file-1' });
  });

  it('forbids a non-admin from deleting someone else file', async () => {
    mockPrisma.uploadedFile.findFirst.mockResolvedValue({
      id: 'file-1',
      tenantId: 'tenant-1',
      uploadedById: 'user-2',
      objectKey: 'media/tenant-1/general/a.png',
      url: 'http://localhost:9000/inventory/media/tenant-1/general/a.png',
      originalName: 'a.png',
      mimeType: 'image/png',
      size: 10,
      kind: 'general',
      createdAt: new Date('2026-08-19T10:00:00.000Z'),
    });

    const { fileService } = await import('../../src/modules/file/file.service');
    await expect(
      fileService.deleteFile('file-1', 'tenant-1', { userId: 'user-3', role: 'staff' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockStorage.deleteObject).not.toHaveBeenCalled();
  });
});
