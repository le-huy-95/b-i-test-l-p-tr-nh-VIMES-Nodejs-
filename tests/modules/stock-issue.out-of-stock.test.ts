import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

const mockTransaction = vi.fn();
const mockPrisma = {
  $transaction: mockTransaction,
  stockIssue: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
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

const notifyIssueOutOfStock = vi.fn();
const notifyIssueStockAvailable = vi.fn();
const notifyIssueCancelled = vi.fn();
const notifyIssueRejected = vi.fn();

vi.mock('../../src/shared/notifications/stock-doc-notify', () => ({
  notifyIssueSubmitted: vi.fn(),
  notifyIssueApproved: vi.fn(),
  notifyIssueRejected,
  notifyIssueCompleted: vi.fn(),
  notifyIssueCancelled,
  notifyIssueOutOfStock,
  notifyIssueStockAvailable,
}));

vi.mock('../../src/modules/document-workflow/document-workflow.service', () => ({
  documentWorkflowService: {
    initWorkflow: vi.fn(),
    startReviewOnCreate: vi.fn(),
  },
}));

vi.mock('../../src/infra/stock-mutation-queue', () => ({
  enqueueStockMutationCompletion: vi.fn(),
}));

vi.mock('../../src/utils/numbering', () => ({
  generateNextCode: vi.fn(),
}));

describe('stock issue out_of_stock', () => {
  const actor = { userId: 'user-1', name: 'Tester' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockReset();
    mockPrisma.stockIssue.findFirst.mockReset();
    mockPrisma.stockIssue.update.mockReset();
  });

  it('markPendingApproval soft-fails to out_of_stock when specific batch lot is empty', async () => {
    mockPrisma.stockIssue.findFirst.mockResolvedValue({
      id: 'issue-1',
      tenantId: 'tenant-1',
      status: 'draft',
      warehouseId: 'warehouse-1',
      code: 'ISSUE-001',
      createdById: 'creator-1',
      details: [],
    });

    const outOfStockIssue = {
      id: 'issue-1',
      status: 'out_of_stock',
      statusBeforeOutOfStock: 'pending_approval',
      code: 'ISSUE-001',
      createdById: 'creator-1',
      details: [],
    };

    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: 'issue-1', status: 'draft', warehouseId: 'warehouse-1' },
      ]),
      stockIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue-1',
          tenantId: 'tenant-1',
          status: 'draft',
          warehouseId: 'warehouse-1',
          details: [
            {
              id: 'line-1',
              productId: 'product-1',
              qtyBaseUnit: '5.0000',
              batchId: 'empty-lot',
            },
          ],
        }),
        update: vi.fn().mockResolvedValue(outOfStockIssue),
      },
      stockIssueDetail: { update: vi.fn() },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            productId: 'product-1',
            batchId: 'empty-lot',
            onhandQty: '0',
            updatedAt: new Date('2026-01-01'),
          },
          {
            productId: 'product-1',
            batchId: 'other-lot',
            onhandQty: '100',
            updatedAt: new Date('2026-01-02'),
          },
        ]),
      },
      batch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'empty-lot',
            expiryDate: new Date('2027-01-01'),
            createdAt: new Date('2026-01-01'),
            unitCost: '5.0000',
          },
          {
            id: 'other-lot',
            expiryDate: new Date('2027-06-01'),
            createdAt: new Date('2026-01-02'),
            unitCost: '6.0000',
          },
        ]),
      },
      stockReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
      },
    };

    mockTransaction.mockImplementation(async (cb: (t: typeof trx) => Promise<unknown>) =>
      cb(trx),
    );

    const { stockIssueService } = await import(
      '../../src/modules/stock-issue/stock-issue.service'
    );
    const result = await stockIssueService.markPendingApproval(
      'tenant-1',
      'issue-1',
      actor,
    );

    expect(trx.stockReservation.createMany).not.toHaveBeenCalled();
    expect(trx.stockIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'out_of_stock',
          statusBeforeOutOfStock: 'pending_approval',
        }),
      }),
    );
    expect(result).toMatchObject({ status: 'out_of_stock' });
    expect(notifyIssueOutOfStock).toHaveBeenCalled();
  });

  it('markPendingApproval soft-fails when requested batchId has no balance row', async () => {
    mockPrisma.stockIssue.findFirst.mockResolvedValue({
      id: 'issue-1',
      tenantId: 'tenant-1',
      status: 'draft',
      warehouseId: 'warehouse-1',
      code: 'ISSUE-001',
      createdById: 'creator-1',
      details: [],
    });

    const outOfStockIssue = {
      id: 'issue-1',
      status: 'out_of_stock',
      statusBeforeOutOfStock: 'pending_approval',
      code: 'ISSUE-001',
      createdById: 'creator-1',
      details: [],
    };

    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: 'issue-1', status: 'draft', warehouseId: 'warehouse-1' },
      ]),
      stockIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue-1',
          tenantId: 'tenant-1',
          status: 'draft',
          warehouseId: 'warehouse-1',
          details: [
            {
              id: 'line-1',
              productId: 'product-1',
              qtyBaseUnit: '2.0000',
              batchId: 'missing-lot',
            },
          ],
        }),
        update: vi.fn().mockResolvedValue(outOfStockIssue),
      },
      stockIssueDetail: { update: vi.fn() },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            productId: 'product-1',
            batchId: 'other-lot',
            onhandQty: '50',
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      },
      batch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'other-lot',
            expiryDate: new Date('2027-01-01'),
            createdAt: new Date('2026-01-01'),
            unitCost: '5.0000',
          },
        ]),
      },
      stockReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
      },
    };

    mockTransaction.mockImplementation(async (cb: (t: typeof trx) => Promise<unknown>) =>
      cb(trx),
    );

    const { stockIssueService } = await import(
      '../../src/modules/stock-issue/stock-issue.service'
    );
    const result = await stockIssueService.markPendingApproval(
      'tenant-1',
      'issue-1',
      actor,
    );

    expect(result).toMatchObject({ status: 'out_of_stock' });
    expect(notifyIssueOutOfStock).toHaveBeenCalled();
  });

  it('markPendingApproval soft-fails to out_of_stock when stock insufficient', async () => {
    mockPrisma.stockIssue.findFirst.mockResolvedValue({
      id: 'issue-1',
      tenantId: 'tenant-1',
      status: 'draft',
      warehouseId: 'warehouse-1',
      code: 'ISSUE-001',
      createdById: 'creator-1',
      details: [],
    });

    const outOfStockIssue = {
      id: 'issue-1',
      status: 'out_of_stock',
      statusBeforeOutOfStock: 'pending_approval',
      code: 'ISSUE-001',
      createdById: 'creator-1',
      details: [],
    };

    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: 'issue-1', status: 'draft', warehouseId: 'warehouse-1' },
      ]),
      stockIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue-1',
          tenantId: 'tenant-1',
          status: 'draft',
          warehouseId: 'warehouse-1',
          details: [
            {
              id: 'line-1',
              productId: 'product-1',
              qtyBaseUnit: '3.0000',
              batchId: null,
            },
          ],
        }),
        update: vi.fn().mockResolvedValue(outOfStockIssue),
      },
      stockIssueDetail: { update: vi.fn() },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: { findMany: vi.fn().mockResolvedValue([]) },
      batch: { findMany: vi.fn().mockResolvedValue([]) },
      stockReservation: {
        updateMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
      },
    };

    mockTransaction.mockImplementation(async (cb: (t: typeof trx) => Promise<unknown>) =>
      cb(trx),
    );

    const { stockIssueService } = await import(
      '../../src/modules/stock-issue/stock-issue.service'
    );
    const result = await stockIssueService.markPendingApproval(
      'tenant-1',
      'issue-1',
      actor,
    );

    expect(trx.stockReservation.createMany).not.toHaveBeenCalled();
    expect(trx.stockIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'out_of_stock',
          statusBeforeOutOfStock: 'pending_approval',
        }),
      }),
    );
    expect(result).toMatchObject({ status: 'out_of_stock' });
    expect(notifyIssueOutOfStock).toHaveBeenCalled();
  });

  it('completeNow soft-fails to out_of_stock when stock insufficient', async () => {
    const outOfStockIssue = {
      id: 'issue-1',
      status: 'out_of_stock',
      statusBeforeOutOfStock: 'approved',
      code: 'ISSUE-001',
      createdById: 'creator-1',
      details: [],
    };

    const mockApply = vi.fn();
    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: 'issue-1', status: 'approved', warehouseId: 'warehouse-1' },
      ]),
      stockIssueDetail: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'line-1',
            productId: 'product-1',
            qtyBaseUnit: '5.0000',
            batchId: null,
          },
        ]),
        update: vi.fn(),
      },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: { findMany: vi.fn().mockResolvedValue([]) },
      batch: { findMany: vi.fn().mockResolvedValue([]) },
      stockReservation: {
        updateMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockIssue: {
        update: vi.fn().mockResolvedValue(outOfStockIssue),
      },
    };

    mockTransaction.mockImplementation(async (cb: (t: typeof trx) => Promise<unknown>) =>
      cb(trx),
    );

    const { StockIssueService } = await import(
      '../../src/modules/stock-issue/stock-issue.service'
    );
    const service = new StockIssueService(mockPrisma as any, {
      apply: mockApply,
    } as any);

    const result = await service.completeNow('tenant-1', 'issue-1', actor);

    expect(mockApply).not.toHaveBeenCalled();
    expect(trx.stockIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'out_of_stock',
          statusBeforeOutOfStock: 'approved',
        }),
      }),
    );
    expect(result).toMatchObject({ status: 'out_of_stock' });
    expect(notifyIssueOutOfStock).toHaveBeenCalled();
  });

  it('rejects completeNow when already out_of_stock', async () => {
    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: 'issue-1', status: 'out_of_stock', warehouseId: 'warehouse-1' },
      ]),
      stockIssueDetail: { findMany: vi.fn() },
      stockIssue: { update: vi.fn() },
    };
    mockTransaction.mockImplementation(async (cb: (t: typeof trx) => Promise<unknown>) =>
      cb(trx),
    );

    const { StockIssueService } = await import(
      '../../src/modules/stock-issue/stock-issue.service'
    );
    const service = new StockIssueService(mockPrisma as any, {
      apply: vi.fn(),
    } as any);

    await expect(
      service.completeNow('tenant-1', 'issue-1', actor),
    ).rejects.toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
      statusCode: 409,
    });
  });

  it('approve is no-op when already out_of_stock so workflow final step cannot overwrite', async () => {
    mockPrisma.stockIssue.findFirst.mockResolvedValue({
      id: 'issue-1',
      status: 'out_of_stock',
      statusBeforeOutOfStock: 'pending_approval',
      code: 'ISSUE-001',
      createdById: 'creator-1',
      details: [],
    });

    const { stockIssueService } = await import(
      '../../src/modules/stock-issue/stock-issue.service'
    );

    const result = await stockIssueService.approve('tenant-1', 'issue-1', actor);

    expect(mockPrisma.stockIssue.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'out_of_stock' });
  });


  it('cancels from out_of_stock and clears out-of-stock fields', async () => {
    const trx = {
      stockIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue-1',
          status: 'out_of_stock',
        }),
        update: vi.fn().mockResolvedValue({
          id: 'issue-1',
          status: 'cancelled',
          code: 'ISSUE-001',
          createdById: 'creator-1',
        }),
      },
      stockReservation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    mockTransaction.mockImplementation(async (cb: (t: typeof trx) => Promise<unknown>) =>
      cb(trx),
    );

    const { stockIssueService } = await import(
      '../../src/modules/stock-issue/stock-issue.service'
    );
    const result = await stockIssueService.cancel('tenant-1', 'issue-1', actor);

    expect(trx.stockIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'cancelled',
          statusBeforeOutOfStock: null,
          outOfStockAt: null,
          outOfStockReason: null,
        }),
      }),
    );
    expect(result).toMatchObject({ status: 'cancelled' });
    expect(notifyIssueCancelled).toHaveBeenCalled();
  });

  it('rejects from out_of_stock and clears out-of-stock fields', async () => {
    const trx = {
      stockIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue-1',
          status: 'out_of_stock',
        }),
        update: vi.fn().mockResolvedValue({
          id: 'issue-1',
          status: 'rejected',
          code: 'ISSUE-001',
          createdById: 'creator-1',
        }),
      },
      stockReservation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    mockTransaction.mockImplementation(async (cb: (t: typeof trx) => Promise<unknown>) =>
      cb(trx),
    );

    const { stockIssueService } = await import(
      '../../src/modules/stock-issue/stock-issue.service'
    );
    const result = await stockIssueService.reject(
      'tenant-1',
      'issue-1',
      'hết hàng lâu',
      actor,
    );

    expect(trx.stockIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          statusBeforeOutOfStock: null,
          outOfStockAt: null,
          outOfStockReason: null,
        }),
      }),
    );
    expect(result).toMatchObject({ status: 'rejected' });
    expect(notifyIssueRejected).toHaveBeenCalled();
  });

  it('tryResolveOutOfStockIssues restores pending_approval and reserves when stock enough', async () => {
    const restored = {
      id: 'issue-1',
      status: 'pending_approval',
      code: 'ISSUE-001',
      createdById: 'creator-1',
      warehouseId: 'warehouse-1',
      details: [],
    };

    mockPrisma.stockIssue.findMany = vi.fn().mockResolvedValue([
      {
        id: 'issue-1',
        tenantId: 'tenant-1',
        warehouseId: 'warehouse-1',
        status: 'out_of_stock',
        statusBeforeOutOfStock: 'pending_approval',
        code: 'ISSUE-001',
        createdById: 'creator-1',
        details: [
          {
            id: 'line-1',
            productId: 'product-1',
            qtyBaseUnit: '2.0000',
            batchId: null,
          },
        ],
      },
    ]);

    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'bal-1' }]),
      stockIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue-1',
          tenantId: 'tenant-1',
          warehouseId: 'warehouse-1',
          status: 'out_of_stock',
          statusBeforeOutOfStock: 'pending_approval',
          details: [
            {
              id: 'line-1',
              productId: 'product-1',
              qtyBaseUnit: '2.0000',
              batchId: null,
            },
          ],
        }),
        update: vi.fn().mockResolvedValue(restored),
      },
      stockIssueDetail: { update: vi.fn() },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            productId: 'product-1',
            batchId: 'lot-1',
            onhandQty: '10',
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      },
      batch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'lot-1',
            expiryDate: new Date('2027-01-01'),
            createdAt: new Date('2026-01-01'),
            unitCost: '5.0000',
          },
        ]),
      },
      stockReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction.mockImplementation(async (cb: (t: typeof trx) => Promise<unknown>) =>
      cb(trx),
    );

    const { StockIssueService } = await import(
      '../../src/modules/stock-issue/stock-issue.service'
    );
    const service = new StockIssueService(mockPrisma as any, {
      apply: vi.fn(),
    } as any);

    const resolved = await service.tryResolveOutOfStockIssues(
      'tenant-1',
      'warehouse-1',
      ['product-1'],
      actor,
    );

    expect(trx.stockReservation.createMany).toHaveBeenCalled();
    expect(trx.stockIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending_approval',
          statusBeforeOutOfStock: null,
          outOfStockAt: null,
          outOfStockReason: null,
        }),
      }),
    );
    expect(notifyIssueStockAvailable).toHaveBeenCalled();
    expect(resolved).toHaveLength(1);
  });

  it('tryResolveOutOfStockIssues restores approved without reservation', async () => {
    const restored = {
      id: 'issue-1',
      status: 'approved',
      code: 'ISSUE-001',
      createdById: 'creator-1',
      details: [],
    };

    mockPrisma.stockIssue.findMany = vi.fn().mockResolvedValue([
      {
        id: 'issue-1',
        tenantId: 'tenant-1',
        warehouseId: 'warehouse-1',
        status: 'out_of_stock',
        statusBeforeOutOfStock: 'approved',
        code: 'ISSUE-001',
        createdById: 'creator-1',
        details: [
          {
            id: 'line-1',
            productId: 'product-1',
            qtyBaseUnit: '2.0000',
            batchId: null,
          },
        ],
      },
    ]);

    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'bal-1' }]),
      stockIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue-1',
          tenantId: 'tenant-1',
          warehouseId: 'warehouse-1',
          status: 'out_of_stock',
          statusBeforeOutOfStock: 'approved',
          details: [
            {
              id: 'line-1',
              productId: 'product-1',
              qtyBaseUnit: '2.0000',
              batchId: null,
            },
          ],
        }),
        update: vi.fn().mockResolvedValue(restored),
      },
      stockIssueDetail: { update: vi.fn() },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          {
            productId: 'product-1',
            batchId: 'lot-1',
            onhandQty: '10',
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      },
      batch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'lot-1',
            expiryDate: new Date('2027-01-01'),
            createdAt: new Date('2026-01-01'),
            unitCost: '5.0000',
          },
        ]),
      },
      stockReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
      },
    };

    mockTransaction.mockImplementation(async (cb: (t: typeof trx) => Promise<unknown>) =>
      cb(trx),
    );

    const { StockIssueService } = await import(
      '../../src/modules/stock-issue/stock-issue.service'
    );
    const service = new StockIssueService(mockPrisma as any, {
      apply: vi.fn(),
    } as any);

    await service.tryResolveOutOfStockIssues(
      'tenant-1',
      'warehouse-1',
      ['product-1'],
      actor,
    );

    expect(trx.stockReservation.createMany).not.toHaveBeenCalled();
    expect(trx.stockIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'approved' }),
      }),
    );
    expect(notifyIssueStockAvailable).toHaveBeenCalled();
  });

  it('tryResolveOutOfStockIssues keeps out_of_stock when still insufficient', async () => {
    mockPrisma.stockIssue.findMany = vi.fn().mockResolvedValue([
      {
        id: 'issue-1',
        tenantId: 'tenant-1',
        warehouseId: 'warehouse-1',
        status: 'out_of_stock',
        statusBeforeOutOfStock: 'pending_approval',
        code: 'ISSUE-001',
        createdById: 'creator-1',
        details: [
          {
            id: 'line-1',
            productId: 'product-1',
            qtyBaseUnit: '99.0000',
            batchId: null,
          },
        ],
      },
    ]);

    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      stockIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue-1',
          tenantId: 'tenant-1',
          warehouseId: 'warehouse-1',
          status: 'out_of_stock',
          statusBeforeOutOfStock: 'pending_approval',
          details: [
            {
              id: 'line-1',
              productId: 'product-1',
              qtyBaseUnit: '99.0000',
              batchId: null,
            },
          ],
        }),
        update: vi.fn(),
      },
      stockIssueDetail: { update: vi.fn() },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      stockBalance: { findMany: vi.fn().mockResolvedValue([]) },
      batch: { findMany: vi.fn().mockResolvedValue([]) },
      stockReservation: {
        updateMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
      },
    };

    mockTransaction.mockImplementation(async (cb: (t: typeof trx) => Promise<unknown>) =>
      cb(trx),
    );

    const { StockIssueService } = await import(
      '../../src/modules/stock-issue/stock-issue.service'
    );
    const service = new StockIssueService(mockPrisma as any, {
      apply: vi.fn(),
    } as any);

    const resolved = await service.tryResolveOutOfStockIssues(
      'tenant-1',
      'warehouse-1',
      ['product-1'],
      actor,
    );

    expect(resolved).toEqual([]);
    expect(trx.stockIssue.update).not.toHaveBeenCalled();
    expect(notifyIssueStockAvailable).not.toHaveBeenCalled();
  });
});
