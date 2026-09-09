import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

const mockApply = vi.fn();
const mockGenerateNextCode = vi.fn();
const mockTransaction = vi.fn();
const mockInitWorkflow = vi.fn();
const mockPerformAction = vi.fn();
const mockStartReviewOnCreate = vi.fn();
const mockPrisma = {
  $transaction: mockTransaction,
  stockIssue: { create: vi.fn(), findFirst: vi.fn() },
  product: { findMany: vi.fn() },
  userTenant: { findMany: vi.fn() },
};

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/utils/numbering', () => ({
  generateNextCode: mockGenerateNextCode,
}));

vi.mock('../../src/modules/stock-balance/stock-balance.service', () => ({
  stockBalanceService: {
    getAvailable: vi.fn(),
  },
}));

vi.mock('../../src/modules/stock-balance/stock-posting.service', () => ({
  stockPostingService: { apply: mockApply },
}));

vi.mock('../../src/modules/stock-balance/qty', () => ({
  resolveQtyBaseUnit: vi.fn(),
}));

vi.mock('../../src/shared/notifications/stock-doc-notify', () => ({
  notifyIssueSubmitted: vi.fn(),
  notifyIssueApproved: vi.fn(),
  notifyIssueRejected: vi.fn(),
  notifyIssueCompleted: vi.fn(),
  notifyIssueCancelled: vi.fn(),
}));

vi.mock('../../src/modules/document-workflow/document-workflow.service', () => ({
  documentWorkflowService: {
    initWorkflow: mockInitWorkflow,
    performAction: mockPerformAction,
    startReviewOnCreate: mockStartReviewOnCreate,
    getWorkflow: vi.fn().mockResolvedValue({
      status: 'in_review',
      currentStepCode: 'warehouse',
    }),
  },
}));

vi.mock('../../src/modules/document-workflow/adapters/stock-document-adapter', () => ({
  getDocumentAdapter: vi.fn().mockReturnValue({}),
}));

describe('stock issue service', () => {
  beforeEach(() => {
    mockApply.mockReset();
    mockGenerateNextCode.mockReset();
    mockTransaction.mockReset();
    mockInitWorkflow.mockReset();
    mockPerformAction.mockReset();
    mockStartReviewOnCreate.mockReset();
    mockPrisma.stockIssue.create.mockReset();
    mockPrisma.stockIssue.findFirst.mockReset();
    mockPrisma.product.findMany.mockReset();
  });

  it('initializes workflow and starts in_review while doc stays draft', async () => {
    mockGenerateNextCode.mockResolvedValue('ISSUE-001');
    mockPrisma.stockIssue.create.mockResolvedValue({ id: 'issue-1', status: 'draft' });
    mockPrisma.stockIssue.findFirst.mockResolvedValue({
      id: 'issue-1',
      status: 'draft',
    });
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        baseUnitName: 'pcs',
        units: [{ unitName: 'pcs', conversionRate: 1 }],
      },
    ]);
    mockStartReviewOnCreate.mockResolvedValue({ status: 'in_review' });

    const { stockIssueService } = await import('../../src/modules/stock-issue/stock-issue.service');
    const result = await stockIssueService.create('tenant-1', 'user-1', {
      warehouseId: 'wh-1',
      issueType: 'internal_use',
      issueDate: '2026-08-19',
      lines: [
        { productId: 'product-1', unitName: 'pcs', requestedQty: 1, actualQty: 1 },
      ],
    });

    expect(mockInitWorkflow).toHaveBeenCalledWith(
      'tenant-1',
      'stock_issue',
      'issue-1',
      { userId: 'user-1', name: undefined },
      {},
      undefined,
    );
    expect(mockStartReviewOnCreate).toHaveBeenCalledWith(
      'tenant-1',
      'stock_issue',
      'issue-1',
      { userId: 'user-1', name: undefined },
      {},
    );
    expect(mockPerformAction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'issue-1',
      status: 'draft',
      workflowStatus: 'in_review',
      currentStepCode: 'warehouse',
    });
  });

  it('persists deliveredByName on create so GET can show người giao hàng', async () => {
    mockGenerateNextCode.mockResolvedValue('ISSUE-002');
    mockPrisma.stockIssue.create.mockResolvedValue({
      id: 'issue-2',
      status: 'draft',
      deliveredByName: 'Nguyễn Văn Giao',
    });
    mockPrisma.stockIssue.findFirst.mockResolvedValue({
      id: 'issue-2',
      status: 'draft',
      deliveredByName: 'Nguyễn Văn Giao',
    });
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        baseUnitName: 'pcs',
        units: [{ unitName: 'pcs', conversionRate: 1 }],
      },
    ]);
    mockStartReviewOnCreate.mockResolvedValue({ status: 'in_review' });

    const { stockIssueService } = await import('../../src/modules/stock-issue/stock-issue.service');
    const result = await stockIssueService.create('tenant-1', 'user-1', {
      warehouseId: 'wh-1',
      issueType: 'internal_use',
      issueDate: '2026-09-09',
      deliveredByName: 'Nguyễn Văn Giao',
      lines: [
        { productId: 'product-1', unitName: 'pcs', requestedQty: 1, actualQty: 1 },
      ],
    });

    expect(mockPrisma.stockIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveredByName: 'Nguyễn Văn Giao',
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 'issue-2',
      deliveredByName: 'Nguyễn Văn Giao',
    });
  });

  it('completes an approved issue via posting and consumes reservations', async () => {
    mockApply.mockResolvedValue(undefined);

    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: 'issue-1', status: 'approved', warehouse_id: 'warehouse-1' },
      ]),
      stockIssueDetail: {
        findMany: vi.fn().mockResolvedValue([
          {
            productId: 'product-1',
            qtyBaseUnit: '3.0000',
            unitPrice: '0',
          },
        ]),
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
          { productId: 'product-1', batchId: null, onhandQty: '10', updatedAt: new Date('2026-01-01') },
        ]),
      },
      batch: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockIssue: {
        update: vi.fn().mockResolvedValue({ id: 'issue-1', status: 'completed' }),
      },
    };

    mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));

    const { stockIssueService } = await import('../../src/modules/stock-issue/stock-issue.service');

    const actor = { userId: 'user-1', name: 'Tester' };
    const result = await stockIssueService.completeNow('tenant-1', 'issue-1', actor);

    expect(mockApply).toHaveBeenCalledWith(
      {
        direction: 'out',
        changes: [
          {
            tenantId: 'tenant-1',
            productId: 'product-1',
            warehouseId: 'warehouse-1',
            batchId: null,
            qtyBaseUnit: '3.0000',
            unitCost: '0',
          },
        ],
        ledger: {
          refDocType: 'stock_issue',
          refDocId: 'issue-1',
          createdById: 'user-1',
        },
      },
      trx,
    );
    expect(trx.stockReservation.updateMany).toHaveBeenCalledWith({
      where: { refDocType: 'stock_issue', refDocId: 'issue-1', status: 'active' },
      data: { status: 'consumed' },
    });
    expect(result).toMatchObject({ id: 'issue-1', status: 'completed' });
  });

  it('allocates sequential FEFO lines from remaining lots and uses lot unit cost', async () => {
    mockApply.mockResolvedValue(undefined);

    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: 'issue-1', status: 'approved', warehouse_id: 'warehouse-1' },
      ]),
      stockIssueDetail: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'line-1', productId: 'product-1', qtyBaseUnit: '3.0000', unitPrice: '0', batchId: null },
          { id: 'line-2', productId: 'product-1', qtyBaseUnit: '3.0000', unitPrice: '0', batchId: null },
        ]),
        update: vi.fn(),
        create: vi.fn(),
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
          { productId: 'product-1', batchId: 'early', onhandQty: '3', updatedAt: new Date('2026-01-10') },
          { productId: 'product-1', batchId: 'mid', onhandQty: '5', updatedAt: new Date('2026-01-01') },
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
          {
            id: 'mid',
            expiryDate: new Date('2026-09-01'),
            createdAt: new Date('2026-01-01'),
            unitCost: '8.0000',
          },
        ]),
      },
      stockReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockIssue: {
        update: vi.fn().mockResolvedValue({ id: 'issue-1', status: 'completed' }),
      },
    };

    mockTransaction.mockImplementation(async (cb: (trx: typeof trx) => Promise<unknown>) => cb(trx));

    const { stockIssueService } = await import('../../src/modules/stock-issue/stock-issue.service');
    const actor = { userId: 'user-1', name: 'Tester' };
    await stockIssueService.completeNow('tenant-1', 'issue-1', actor);

    expect(mockApply).toHaveBeenCalledWith(
      {
        direction: 'out',
        changes: [
          {
            tenantId: 'tenant-1',
            productId: 'product-1',
            warehouseId: 'warehouse-1',
            batchId: 'early',
            qtyBaseUnit: '1.0000',
            unitCost: '7.0000',
          },
          {
            tenantId: 'tenant-1',
            productId: 'product-1',
            warehouseId: 'warehouse-1',
            batchId: 'mid',
            qtyBaseUnit: '5.0000',
            unitCost: '8.0000',
          },
        ],
        ledger: {
          refDocType: 'stock_issue',
          refDocId: 'issue-1',
          createdById: 'user-1',
        },
      },
      trx,
    );
    expect(trx.stockIssueDetail.update).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: { batchId: 'mid' },
    });
    expect(trx.stockIssueDetail.update).not.toHaveBeenCalledWith({
      where: { id: 'line-2' },
      data: { batchId: 'mid' },
    });
  });
});
