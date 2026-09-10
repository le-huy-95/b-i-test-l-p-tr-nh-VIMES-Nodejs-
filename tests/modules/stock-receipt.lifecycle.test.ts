import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

const mockGenerateNextCode = vi.fn();
const mockTransaction = vi.fn();
const mockGetAvailable = vi.fn();
const mockPrisma = {
  $transaction: mockTransaction,
  stockReceipt: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock('../../src/infra/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../src/shared/notifications/stock-doc-notify', () => ({
  notifyReceiptSubmitted: vi.fn(),
  notifyReceiptApproved: vi.fn(),
  notifyReceiptRejected: vi.fn(),
  notifyReceiptCompleted: vi.fn(),
  notifyReceiptCancelled: vi.fn(),
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

describe('stock receipt lifecycle', () => {
  beforeEach(() => {
    mockGenerateNextCode.mockReset();
    mockTransaction.mockReset();
    mockGetAvailable.mockReset();
    mockPrisma.stockReceipt.findFirst.mockReset();
    mockPrisma.stockReceipt.update.mockReset();
    mockPrisma.stockReceipt.create.mockReset();
  });

  it('markPendingApproval and approves a receipt', async () => {
    mockPrisma.stockReceipt.findFirst.mockResolvedValue({
      id: 'receipt-1',
      tenantId: 'tenant-1',
      warehouseId: 'warehouse-1',
      status: 'draft',
      details: [],
      supplier: null,
      warehouse: null,
    });
    mockPrisma.stockReceipt.update.mockResolvedValue({ id: 'receipt-1', status: 'pending_approval' });

    const { stockReceiptService } = await import('../../src/modules/stock-receipt/stock-receipt.service');
    const actor = { userId: 'user-1', name: 'Tester' };
    const submitted = await stockReceiptService.markPendingApproval('tenant-1', 'receipt-1', actor);

    expect(submitted).toMatchObject({ status: 'pending_approval' });

    mockPrisma.stockReceipt.findFirst.mockResolvedValue({
      id: 'receipt-1',
      tenantId: 'tenant-1',
      warehouseId: 'warehouse-1',
      status: 'pending_approval',
      details: [],
      supplier: null,
      warehouse: null,
    });
    mockPrisma.stockReceipt.update.mockResolvedValue({ id: 'receipt-1', status: 'approved' });

    const approved = await stockReceiptService.approve('tenant-1', 'receipt-1', actor);

    expect(approved).toMatchObject({ status: 'approved' });
    expect(mockPrisma.stockReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvedById: 'user-1' }),
      }),
    );
  });

  it('cancels a draft receipt', async () => {
    mockPrisma.stockReceipt.findFirst.mockResolvedValue({
      id: 'receipt-2',
      tenantId: 'tenant-1',
      warehouseId: 'warehouse-1',
      status: 'draft',
      details: [],
      supplier: null,
      warehouse: null,
    });
    mockPrisma.stockReceipt.update.mockResolvedValue({ id: 'receipt-2', status: 'cancelled' });

    const { stockReceiptService } = await import('../../src/modules/stock-receipt/stock-receipt.service');
    const actor = { userId: 'user-1', name: 'Tester' };
    const cancelled = await stockReceiptService.cancel('tenant-1', 'receipt-2', actor);

    expect(cancelled).toMatchObject({ status: 'cancelled' });
  });
});
