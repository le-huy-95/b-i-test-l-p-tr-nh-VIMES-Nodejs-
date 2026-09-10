import { describe, expect, it, vi } from "vitest";
import { CacheInvalidationService } from "../../src/infra/cache-invalidation";
import { StockReceiptService } from "../../src/modules/stock-receipt/stock-receipt.service";
import { Decimal } from "../../src/utils/decimal";
import { AppError } from "../../src/utils/app-error";

describe("stock receipt get cache", () => {
  it("uses detail cache key with org visibility and preserves Decimal totalAmount", async () => {
    const getOrSet = vi.fn(async (_key: string, loader: () => Promise<unknown>) =>
      loader(),
    );
    const cache = {
      getOrSet,
      get: vi.fn(),
      set: vi.fn(),
      invalidatePattern: vi.fn(),
      invalidate: vi.fn(),
    };
    const doc = {
      id: "receipt-1",
      tenantId: "tenant-1",
      totalAmount: new Decimal("4250000.00"),
      createdAt: new Date("2026-09-07T10:00:00.000Z"),
      receiptDate: new Date("2026-09-07T00:00:00.000Z"),
      details: [],
      supplier: null,
      warehouse: { id: "wh-1" },
    };
    const db = {
      stockReceipt: {
        findFirst: vi.fn().mockResolvedValue(doc),
      },
      documentWorkflowStep: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const service = new StockReceiptService(db as never, {} as never, cache as never);
    const result = await service.get("tenant-1", "receipt-1", {
      userId: "user-1",
      role: "admin",
    });

    expect(getOrSet).toHaveBeenCalledWith(
      "detail:stock-receipts:tenant-1:org:receipt-1",
      expect.any(Function),
    );
    expect(result.totalAmount).toBe(doc.totalAmount);
    expect(JSON.stringify(result)).toContain('"totalAmount":"4250000"');
    expect(JSON.stringify(result)).not.toContain('"s":');
  });

  it("uses user visibility key for related_documents roles", async () => {
    const getOrSet = vi.fn(async (_key: string, loader: () => Promise<unknown>) =>
      loader(),
    );
    const cache = {
      getOrSet,
      get: vi.fn(),
      set: vi.fn(),
      invalidatePattern: vi.fn(),
      invalidate: vi.fn(),
    };
    const db = {
      stockReceipt: {
        findFirst: vi.fn().mockResolvedValue({
          id: "receipt-1",
          totalAmount: new Decimal("1"),
          details: [],
        }),
      },
      documentWorkflowStep: {
        findMany: vi.fn().mockResolvedValue([{ documentId: "receipt-1" }]),
      },
    };

    const service = new StockReceiptService(db as never, {} as never, cache as never);
    await service.get("tenant-1", "receipt-1", {
      userId: "viewer-1",
      role: "viewer",
    });

    expect(getOrSet).toHaveBeenCalledWith(
      "detail:stock-receipts:tenant-1:user:viewer-1:receipt-1",
      expect.any(Function),
    );
  });

  it("does not swallow NOT_FOUND from loader (no cache write on miss)", async () => {
    const getOrSet = vi.fn(async (_key: string, loader: () => Promise<unknown>) =>
      loader(),
    );
    const cache = {
      getOrSet,
      get: vi.fn(),
      set: vi.fn(),
      invalidatePattern: vi.fn(),
      invalidate: vi.fn(),
    };
    const db = {
      stockReceipt: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      documentWorkflowStep: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const service = new StockReceiptService(db as never, {} as never, cache as never);
    await expect(
      service.get("tenant-1", "missing", {
        userId: "user-1",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<AppError>);
    expect(cache.set).not.toHaveBeenCalled();
  });
});

describe("stock document cache invalidation", () => {
  it("lazy-deletes detail:stock-receipts prefix with list prefixes", async () => {
    const invalidatePattern = vi.fn().mockResolvedValue(undefined);
    const service = new CacheInvalidationService({
      get: vi.fn(),
      set: vi.fn(),
      getOrSet: vi.fn(),
      invalidatePattern,
      invalidate: vi.fn(),
    });

    await service.invalidateStockDocuments("tenant-1");

    expect(invalidatePattern).toHaveBeenCalledWith(
      "detail:stock-receipts:tenant-1:",
    );
    expect(invalidatePattern).toHaveBeenCalledWith(
      "list:stock-receipts:tenant-1:",
    );
  });
});
