import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApply = vi.fn();
const mockGenerateNextCode = vi.fn();
const mockTransaction = vi.fn();
const mockInitWorkflow = vi.fn();

const mockPrisma = {
  $transaction: mockTransaction,
  product: { findMany: vi.fn() },
  stockReceipt: { create: vi.fn() },
  userTenant: { findMany: vi.fn() },
};

vi.mock("../../src/infra/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../src/utils/numbering", () => ({
  generateNextCode: mockGenerateNextCode,
}));

vi.mock("../../src/modules/stock-balance/stock-posting.service", () => ({
  stockPostingService: { apply: mockApply },
}));

vi.mock("../../src/modules/stock-balance/qty", () => ({
  resolveQtyBaseUnit: vi.fn(),
}));

vi.mock("../../src/shared/notifications/stock-doc-notify", () => ({
  notifyReceiptSubmitted: vi.fn(),
  notifyReceiptApproved: vi.fn(),
  notifyReceiptRejected: vi.fn(),
  notifyReceiptCompleted: vi.fn(),
  notifyReceiptCancelled: vi.fn(),
}));

vi.mock("../../src/modules/document-workflow/document-workflow.service", () => ({
  documentWorkflowService: {
    initWorkflow: mockInitWorkflow,
  },
}));

vi.mock("../../src/modules/document-workflow/adapters/stock-document-adapter", () => ({
  getDocumentAdapter: vi.fn().mockReturnValue({}),
}));

describe("stock receipt service", () => {
  beforeEach(() => {
    mockApply.mockReset();
    mockGenerateNextCode.mockReset();
    mockTransaction.mockReset();
    mockInitWorkflow.mockReset();
    mockPrisma.product.findMany.mockReset();
    mockPrisma.stockReceipt.create.mockReset();
    mockPrisma.userTenant.findMany.mockReset();
  });

  it("completes an approved receipt via stock posting", async () => {
    mockApply.mockResolvedValue(undefined);

    const trx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([
          { id: "receipt-1", status: "approved", warehouse_id: "warehouse-1", supplier_id: null },
        ]),
      stockReceiptDetail: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "line-1",
            productId: "product-1",
            qtyBaseUnit: "5.0000",
            unitPrice: "20.0000",
            batchId: null,
            batchNo: null,
            expiryDate: null,
          },
        ]),
        update: vi.fn(),
      },
      product: {
        findMany: vi.fn().mockResolvedValue([{ id: "product-1" }]),
      },
      stockReceipt: {
        update: vi
          .fn()
          .mockResolvedValue({ id: "receipt-1", status: "completed" }),
      },
    };

    mockTransaction.mockImplementation(
      async (cb: (trx: any) => Promise<unknown>) => cb(trx),
    );

    const { stockReceiptService } =
      await import("../../src/modules/stock-receipt/stock-receipt.service");

    const actor = { userId: "user-1", name: "Tester" };
    const result = await stockReceiptService.completeNow(
      "tenant-1",
      "receipt-1",
      actor,
    );

    expect(mockApply).toHaveBeenCalledWith(
      {
        direction: "in",
        changes: [
          {
            tenantId: "tenant-1",
            productId: "product-1",
            warehouseId: "warehouse-1",
            batchId: null,
            qtyBaseUnit: "5.0000",
            unitCost: "20.0000",
          },
        ],
        ledger: {
          refDocType: "stock_receipt",
          refDocId: "receipt-1",
          createdById: "user-1",
        },
      },
      trx,
    );
    expect(result).toMatchObject({ id: "receipt-1", status: "completed" });
  });

  it("initializes workflow when creating a receipt", async () => {
    mockGenerateNextCode.mockResolvedValue("RECEIPT-001");
    mockPrisma.stockReceipt.create.mockResolvedValue({ id: "receipt-1" });
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: "product-1",
        baseUnitName: "pcs",
        units: [{ unitName: "pcs", conversionRate: 1 }],
      },
    ]);

    const { stockReceiptService } = await import("../../src/modules/stock-receipt/stock-receipt.service");
    await stockReceiptService.create("tenant-1", "user-1", {
      warehouseId: "wh-1",
      receiptType: "purchase",
      receiptDate: "2026-08-19",
      lines: [
        { productId: "product-1", unitName: "pcs", expectedQty: 1, actualQty: 1, unitPrice: 10 },
      ],
    });

    expect(mockInitWorkflow).toHaveBeenCalledWith(
      "tenant-1",
      "stock_receipt",
      "receipt-1",
      { userId: "user-1", name: undefined },
      {},
      undefined,
    );
  });

  it("merges same product+batch lines with weighted-average unit cost", async () => {
    mockApply.mockResolvedValue(undefined);

    const trx = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: "receipt-1", status: "approved", warehouse_id: "warehouse-1", supplier_id: null },
      ]),
      stockReceiptDetail: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "line-1",
            productId: "product-1",
            qtyBaseUnit: "2.0000",
            unitPrice: "10.0000",
            batchId: null,
            batchNo: "LOT-01",
            expiryDate: null,
          },
          {
            id: "line-2",
            productId: "product-1",
            qtyBaseUnit: "6.0000",
            unitPrice: "20.0000",
            batchId: null,
            batchNo: "LOT-01",
            expiryDate: null,
          },
        ]),
        update: vi.fn(),
      },
      product: {
        findMany: vi.fn().mockResolvedValue([{ id: "product-1" }]),
      },
      batch: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "batch-1" }),
        update: vi.fn(),
      },
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      stockReceipt: {
        update: vi.fn().mockResolvedValue({ id: "receipt-1", status: "completed" }),
      },
    };

    mockTransaction.mockImplementation(async (cb: (trx: any) => Promise<unknown>) => cb(trx));

    const { stockReceiptService } = await import("../../src/modules/stock-receipt/stock-receipt.service");
    const actor = { userId: "user-1", name: "Tester" };
    await stockReceiptService.completeNow("tenant-1", "receipt-1", actor);

    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [
          expect.objectContaining({
            productId: "product-1",
            batchId: "batch-1",
            qtyBaseUnit: "8.0000",
            unitCost: "17.5000",
          }),
        ],
      }),
      trx,
    );
  });
});
