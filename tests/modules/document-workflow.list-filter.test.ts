import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

const mockWorkflowFindMany = vi.fn();
const mockWorkflowCount = vi.fn();
const mockStockIssueFindMany = vi.fn();
const mockStockReceiptFindMany = vi.fn();
const mockStockOpeningFindMany = vi.fn();

const mockPrisma = {
  $transaction: vi.fn(),
  documentWorkflow: {
    findFirst: vi.fn(),
    findMany: mockWorkflowFindMany,
    create: vi.fn(),
    update: vi.fn(),
    count: mockWorkflowCount,
  },
  documentWorkflowStep: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  documentStepAuthorization: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  documentStatusHistory: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  stockIssue: {
    findMany: mockStockIssueFindMany,
  },
  stockReceipt: {
    findMany: mockStockReceiptFindMany,
  },
  stockOpeningBalance: {
    findMany: mockStockOpeningFindMany,
  },
};

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/infra/cache-invalidation', () => ({
  cacheInvalidationService: {
    invalidateStockDocuments: vi.fn(),
    invalidateStockMutations: vi.fn(),
  },
}));

describe('document workflow list filter (search / warehouseId)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses search + warehouseId and treats blank as omitted', async () => {
    const { workflowListQuerySchema } = await import(
      '../../src/dto/document-workflow.dto'
    );

    expect(
      workflowListQuerySchema.parse({
        documentType: 'stock_issue',
        search: '  PX-01  ',
        warehouseId: 'wh-1',
      }),
    ).toMatchObject({
      documentType: 'stock_issue',
      search: 'PX-01',
      warehouseId: 'wh-1',
    });

    expect(
      workflowListQuerySchema.parse({
        search: '   ',
        warehouseId: '',
      }),
    ).toMatchObject({
      search: undefined,
      warehouseId: undefined,
    });
  });

  it('search by code filters documentId via stock_issue lookup', async () => {
    mockStockIssueFindMany.mockResolvedValue([{ id: 'doc-match' }]);
    mockWorkflowFindMany.mockResolvedValue([
      {
        id: 'wf-1',
        tenantId: 'tenant-1',
        documentType: 'stock_issue',
        documentId: 'doc-match',
        status: 'draft',
        currentStepCode: null,
        currentStepStatus: null,
        currentStepUpdatedAt: null,
        lastActionById: null,
        lastActionAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 0,
        steps: [],
      },
    ]);
    mockWorkflowCount.mockResolvedValue(1);

    const { documentWorkflowService } = await import(
      '../../src/modules/document-workflow/document-workflow.service'
    );

    const result = await documentWorkflowService.listWorkflows(
      'tenant-1',
      {
        documentType: 'stock_issue',
        search: 'PX-99',
        page: 1,
        limit: 20,
      },
      { userId: 'admin-1', role: 'admin' },
    );

    expect(mockStockIssueFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        OR: [
          { code: { contains: 'PX-99', mode: 'insensitive' } },
          {
            warehouse: {
              name: { contains: 'PX-99', mode: 'insensitive' },
            },
          },
        ],
      },
      select: { id: true },
    });
    expect(mockStockReceiptFindMany).not.toHaveBeenCalled();
    expect(mockWorkflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          documentType: 'stock_issue',
          documentId: { in: ['doc-match'] },
        }),
      }),
    );
    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it('warehouseId filters documentId and returns empty page when no match', async () => {
    mockStockIssueFindMany.mockResolvedValue([]);

    const { documentWorkflowService } = await import(
      '../../src/modules/document-workflow/document-workflow.service'
    );

    const result = await documentWorkflowService.listWorkflows(
      'tenant-1',
      {
        documentType: 'stock_issue',
        warehouseId: 'wh-missing',
        page: 1,
        limit: 20,
      },
      { userId: 'admin-1', role: 'admin' },
    );

    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    expect(mockWorkflowFindMany).not.toHaveBeenCalled();
  });

  it('without search/warehouseId does not lookup stock docs', async () => {
    mockWorkflowFindMany.mockResolvedValue([]);
    mockWorkflowCount.mockResolvedValue(0);

    const { documentWorkflowService } = await import(
      '../../src/modules/document-workflow/document-workflow.service'
    );

    await documentWorkflowService.listWorkflows(
      'tenant-1',
      {
        documentType: 'stock_receipt',
        status: 'in_review',
        page: 1,
        limit: 20,
      },
      { userId: 'admin-1', role: 'admin' },
    );

    expect(mockStockIssueFindMany).not.toHaveBeenCalled();
    expect(mockStockReceiptFindMany).not.toHaveBeenCalled();
    expect(mockWorkflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          documentType: 'stock_receipt',
          status: 'in_review',
        },
      }),
    );
  });
});
