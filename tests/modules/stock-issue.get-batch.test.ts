import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockIssueService } from "../../src/modules/stock-issue/stock-issue.service";
import { Decimal } from "../../src/utils/decimal";

describe("stock issue get embeds batch", () => {
  const findFirst = vi.fn();
  const workflowFindMany = vi.fn();
  const db = {
    stockIssue: { findFirst },
    documentWorkflowStep: { findMany: workflowFindMany },
  } as any;
  const service = new StockIssueService(db, {} as any, {
    getOrSet: vi.fn(),
  } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    workflowFindMany.mockResolvedValue([]);
  });

  it("includes selected batch fields and omits tenantId/receiptDetailId", async () => {
    findFirst.mockResolvedValue({
      id: "issue-1",
      tenantId: "tenant-1",
      details: [
        {
          id: "line-1",
          productId: "product-1",
          batchId: "batch-1",
          batch: {
            id: "batch-1",
            productId: "product-1",
            warehouseId: "wh-1",
            batchNo: "L001",
            manufactureDate: new Date("2026-01-15T00:00:00.000Z"),
            expiryDate: new Date("2027-01-15T00:00:00.000Z"),
            supplierId: null,
            unitCost: new Decimal("10000.0000"),
            createdAt: new Date("2026-09-01T03:00:00.000Z"),
          },
        },
      ],
      customer: null,
      warehouse: { id: "wh-1" },
    });

    const result = await service.get("tenant-1", "issue-1", {
      userId: "admin-1",
      role: "admin",
    });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          details: {
            include: {
              batch: {
                select: {
                  id: true,
                  productId: true,
                  warehouseId: true,
                  batchNo: true,
                  manufactureDate: true,
                  expiryDate: true,
                  supplierId: true,
                  unitCost: true,
                  createdAt: true,
                },
              },
            },
          },
        }),
      }),
    );

    const line = result.details[0] as any;
    expect(line.batchId).toBe("batch-1");
    expect(line.batch).toMatchObject({
      id: "batch-1",
      batchNo: "L001",
      productId: "product-1",
      warehouseId: "wh-1",
      supplierId: null,
    });
    expect(line.batch.tenantId).toBeUndefined();
    expect(line.batch.receiptDetailId).toBeUndefined();
    expect(String(line.batch.expiryDate)).toContain("+07:00");
    expect(String(line.batch.manufactureDate)).toContain("+07:00");
  });

  it("returns batch null when batchId is null", async () => {
    findFirst.mockResolvedValue({
      id: "issue-2",
      tenantId: "tenant-1",
      details: [
        {
          id: "line-2",
          productId: "product-1",
          batchId: null,
          batch: null,
        },
      ],
      customer: null,
      warehouse: { id: "wh-1" },
    });

    const result = await service.get("tenant-1", "issue-2", {
      userId: "admin-1",
      role: "admin",
    });

    expect((result.details[0] as any).batch).toBeNull();
  });
});
