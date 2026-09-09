import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

const mockGenerateNextCode = vi.fn();
const mockTransaction = vi.fn();
const mockGetAvailable = vi.fn();
const mockPrisma = {
  $transaction: mockTransaction,
  stockIssue: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/shared/notifications/stock-doc-notify', () => ({
  notifyIssueSubmitted: vi.fn(),
  notifyIssueApproved: vi.fn(),
  notifyIssueRejected: vi.fn(),
  notifyIssueCompleted: vi.fn(),
  notifyIssueCancelled: vi.fn(),
}));

vi.mock('../../src/utils/numbering', () => ({
  generateNextCode: mockGenerateNextCode,
}));

vi.mock('../../src/modules/stock-balance/stock-balance.service', () => ({
  stockBalanceService: {
    getAvailable: mockGetAvailable,
  },
}));

vi.mock('../../src/modules/stock-balance/qty', () => ({
  resolveQtyBaseUnit: vi.fn(),
}));

describe('stock issue lifecycle', () => {
  beforeEach(() => {
    mockGenerateNextCode.mockReset();
    mockTransaction.mockReset();
    mockGetAvailable.mockReset();
    mockPrisma.stockIssue.findFirst.mockReset();
    mockPrisma.stockIssue.update.mockReset();
  });

  it('markPendingApproval creates lot-level reservations for a draft issue', async () => {
    mockPrisma.stockIssue.findFirst.mockResolvedValue({
      id: 'issue-1',
      tenantId: 'tenant-1',
      status: 'draft',
      warehouseId: 'warehouse-1',
      details: [],
    });

    const trx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'issue-1', status: 'draft', warehouseId: 'warehouse-1' },
        ])
        .mockResolvedValueOnce([{ id: 'bal-1' }]),
      stockIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue-1',
          tenantId: 'tenant-1',
          status: 'draft',
          warehouseId: 'warehouse-1',
          details: [{ id: 'line-1', productId: 'product-1', qtyBaseUnit: '3.0000', batchId: null }],
        }),
        update: vi.fn().mockResolvedValue({ id: 'issue-1', status: 'pending_approval' }),
      },
      stockIssueDetail: {
        update: vi.fn(),
      },
      product: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'product-1',
            averageCost: '10.0000',
          },
        ]),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { productId: 'product-1', batchId: 'early', onhandQty: '5', updatedAt: new Date('2026-01-10') },
        ]),
      },
      batch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'early',
            expiryDate: new Date('2026-06-01'),
            createdAt: new Date('2026-01-10'),
            unitCost: '7.0000',
          },
        ]),
      },
      stockReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));

    const { stockIssueService } = await import('../../src/modules/stock-issue/stock-issue.service');
    const actor = { userId: 'user-1', name: 'Tester' };
    const result = await stockIssueService.markPendingApproval('tenant-1', 'issue-1', actor);

    expect(trx.stockReservation.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenantId: 'tenant-1',
          productId: 'product-1',
          warehouseId: 'warehouse-1',
          batchId: 'early',
          refDocType: 'stock_issue',
          refDocId: 'issue-1',
          qtyBaseUnit: '3.0000',
          expiresAt: expect.any(Date),
        },
      ],
    });
    expect(result).toMatchObject({ id: 'issue-1', status: 'pending_approval' });
  });

  it('approves a pending issue', async () => {
    mockPrisma.stockIssue.findFirst.mockResolvedValue({
      id: 'issue-1',
      tenantId: 'tenant-1',
      status: 'pending_approval',
      details: [],
      warehouse: { id: 'warehouse-1' },
    });
    mockPrisma.stockIssue.update.mockResolvedValue({ id: 'issue-1', status: 'approved' });

    const { stockIssueService } = await import('../../src/modules/stock-issue/stock-issue.service');
    const actor = { userId: 'user-1', name: 'Tester' };
    const result = await stockIssueService.approve('tenant-1', 'issue-1', actor);

    expect(mockPrisma.stockIssue.update).toHaveBeenCalledWith({
      where: { id: 'issue-1' },
      data: {
        status: 'approved',
        approvedById: 'user-1',
        approvedAt: expect.any(Date),
      },
      include: { details: true },
    });
    expect(result).toMatchObject({ id: 'issue-1', status: 'approved' });
  });

  it('rejects a pending issue and releases reservations', async () => {
    const trx = {
      stockIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue-1',
          tenantId: 'tenant-1',
          status: 'pending_approval',
        }),
        update: vi.fn().mockResolvedValue({ id: 'issue-1', status: 'rejected' }),
      },
      stockReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));

    const { stockIssueService } = await import('../../src/modules/stock-issue/stock-issue.service');
    const actor = { userId: 'user-1', name: 'Tester' };
    const result = await stockIssueService.reject('tenant-1', 'issue-1', 'Not approved', actor);

    expect(trx.stockReservation.updateMany).toHaveBeenCalledWith({
      where: { refDocType: 'stock_issue', refDocId: 'issue-1', status: 'active' },
      data: { status: 'released' },
    });
    expect(result).toMatchObject({ id: 'issue-1', status: 'rejected' });
  });

  it('cancels a draft issue and releases reservations', async () => {
    const trx = {
      stockIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue-1',
          tenantId: 'tenant-1',
          status: 'draft',
        }),
        update: vi.fn().mockResolvedValue({ id: 'issue-1', status: 'cancelled' }),
      },
      stockReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));

    const { stockIssueService } = await import('../../src/modules/stock-issue/stock-issue.service');
    const actor = { userId: 'user-1', name: 'Tester' };
    const result = await stockIssueService.cancel('tenant-1', 'issue-1', actor);

    expect(trx.stockReservation.updateMany).toHaveBeenCalledWith({
      where: { refDocType: 'stock_issue', refDocId: 'issue-1', status: 'active' },
      data: { status: 'released' },
    });
    expect(result).toMatchObject({ id: 'issue-1', status: 'cancelled' });
  });
});
