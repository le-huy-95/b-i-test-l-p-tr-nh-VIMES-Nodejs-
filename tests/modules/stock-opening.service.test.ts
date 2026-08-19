import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApply = vi.fn();
const mockGenerateNextCode = vi.fn();
const mockTransaction = vi.fn();
const mockInitWorkflow = vi.fn();

const mockPrisma = {
  stockOpeningBalance: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  product: {
    findMany: vi.fn(),
  },
  stockLedger: {
    findFirst: vi.fn(),
  },
  $transaction: mockTransaction,
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

vi.mock("../../src/modules/document-workflow/document-workflow.service", () => ({
  documentWorkflowService: {
    initWorkflow: mockInitWorkflow,
  },
}));

vi.mock("../../src/modules/document-workflow/adapters/stock-document-adapter", () => ({
  getDocumentAdapter: vi.fn().mockReturnValue({}),
}));

describe("stock opening service", () => {
  beforeEach(() => {
    mockApply.mockReset();
    mockGenerateNextCode.mockReset();
    mockTransaction.mockReset();
    mockInitWorkflow.mockReset();
    mockPrisma.stockOpeningBalance.findFirst.mockReset();
    mockPrisma.stockOpeningBalance.create.mockReset();
    mockPrisma.stockOpeningBalance.update.mockReset();
    mockPrisma.stockLedger.findFirst.mockReset();
    mockPrisma.product.findMany.mockReset();
  });

  it("creates an opening balance with generated numbering", async () => {
    mockGenerateNextCode.mockResolvedValue("TDK-2026-000001");
    mockPrisma.stockOpeningBalance.findFirst.mockResolvedValue(null);
    mockPrisma.stockOpeningBalance.create.mockResolvedValue({
      id: "opening-1",
    });
    mockPrisma.product.findMany.mockResolvedValue([
      { id: "product-1" },
    ]);
    mockInitWorkflow.mockResolvedValue({ id: "workflow-1" });

    const { stockOpeningService } =
      await import("../../src/modules/stock-opening/stock-opening.service");

    const result = await stockOpeningService.create("tenant-1", "user-1", {
      warehouseId: "warehouse-1",
      effectiveDate: "2026-08-14",
      note: "initial opening",
      lines: [{ productId: "product-1", qty: 10, unitCost: 5 }],
    });

    expect(mockGenerateNextCode).toHaveBeenCalledWith(
      "tenant-1",
      "stock_opening",
    );
    expect(mockPrisma.stockOpeningBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          code: "TDK-2026-000001",
          createdById: "user-1",
        }),
      }),
    );
    expect(mockInitWorkflow).toHaveBeenCalledWith(
      "tenant-1",
      "stock_opening",
      "opening-1",
      { userId: "user-1", name: undefined },
      expect.any(Object),
      undefined,
    );
    expect(result).toEqual({ id: "opening-1" });
  });

  it("posts an opening balance via stock posting", async () => {
    mockApply.mockResolvedValue(undefined);

    const trx = {
      stockOpeningBalance: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "opening-1",
            tenantId: "tenant-1",
            warehouseId: "warehouse-1",
            status: "draft",
            details: [
              {
                id: "open-line-1",
                productId: "product-1",
                qtyBaseUnit: "10.0000",
                unitCost: "5.0000",
                batchNo: "LOT-01",
                expiryDate: new Date("2027-01-01"),
                batchId: null,
              },
            ],
          })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        update: vi
          .fn()
          .mockResolvedValue({ id: "opening-1", status: "completed" }),
      },
      stockOpeningBalanceDetail: {
        update: vi.fn(),
      },
      product: {
        findMany: vi.fn().mockResolvedValue([{ id: "product-1" }]),
      },
      batch: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "batch-1" }),
      },
      stockLedger: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    mockTransaction.mockImplementation(
      async (cb: (trx: any) => Promise<unknown>) => cb(trx),
    );

    const { stockOpeningService } =
      await import("../../src/modules/stock-opening/stock-opening.service");

    const result = await stockOpeningService.post(
      "tenant-1",
      "opening-1",
      "user-1",
    );

    expect(mockApply).toHaveBeenCalledWith(
      {
        direction: "opening",
        changes: [
          {
            tenantId: "tenant-1",
            productId: "product-1",
            warehouseId: "warehouse-1",
            qtyBaseUnit: "10.0000",
            unitCost: "5.0000",
            batchId: "batch-1",
          },
        ],
        ledger: {
          refDocType: "stock_opening_balance",
          refDocId: "opening-1",
          createdById: "user-1",
        },
      },
      trx,
    );
    expect(result).toMatchObject({ id: "opening-1", status: "completed" });
  });
});
