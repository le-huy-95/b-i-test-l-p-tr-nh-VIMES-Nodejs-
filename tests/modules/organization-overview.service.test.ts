import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv(
  "DATABASE_URL",
  "postgresql://postgres:postgres@localhost:5432/test_db",
);
vi.stubEnv("JWT_ACCESS_SECRET", "access-secret");
vi.stubEnv("JWT_REFRESH_SECRET", "refresh-secret");

const mockCache = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  invalidatePattern: vi.fn(),
  invalidate: vi.fn(),
};

const mockPrisma = {
  warehouse: { findMany: vi.fn() },
  stockReceipt: { groupBy: vi.fn(), findMany: vi.fn() },
  stockIssue: { groupBy: vi.fn(), findMany: vi.fn() },
  stockOpeningBalance: { groupBy: vi.fn() },
  stockReceiptDetail: { aggregate: vi.fn(), groupBy: vi.fn() },
  stockIssueDetail: { aggregate: vi.fn(), groupBy: vi.fn() },
  product: { findMany: vi.fn() },
  stockBalance: { findMany: vi.fn() },
  stockReservation: {
    findMany: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  batch: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
};

vi.mock("../../src/infra/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../src/infra/redis-list-cache", () => ({
  listCache: mockCache,
}));

describe("organization overview service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCache.get.mockResolvedValue(null);
    mockPrisma.warehouse.findMany.mockResolvedValue([
      { id: "wh-1", code: "WH01", name: "Kho chính" },
    ]);
    mockPrisma.stockReceipt.groupBy.mockResolvedValue([]);
    mockPrisma.stockIssue.groupBy.mockResolvedValue([]);
    mockPrisma.stockOpeningBalance.groupBy.mockResolvedValue([]);
    mockPrisma.stockReceipt.findMany.mockResolvedValue([]);
    mockPrisma.stockIssue.findMany.mockResolvedValue([]);
    mockPrisma.stockReceiptDetail.aggregate.mockResolvedValue({
      _sum: { qtyBaseUnit: "100.0000" },
    });
    mockPrisma.stockIssueDetail.aggregate.mockResolvedValue({
      _sum: { qtyBaseUnit: "50.0000" },
    });
    mockPrisma.stockReceiptDetail.groupBy.mockResolvedValue([]);
    mockPrisma.stockIssueDetail.groupBy.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.stockBalance.findMany.mockResolvedValue([]);
    mockPrisma.batch.findMany.mockResolvedValue([]);
    mockPrisma.stockReservation.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockImplementation(
      async (query: { strings?: string[] }) => {
        const sql = query.strings?.join("") ?? "";
        if (sql.includes("inventory-metrics")) {
          return [
            {
              skuCount: 0,
              totalOnhandQty: "0",
              totalReservedQty: "0",
              totalAvailableQty: "0",
              estimatedStockValue: "0",
              lowStockCount: 0,
              expiryAlertCount: 0,
              activeReservationCount: 0,
              qtyByUnit: [],
            },
          ];
        }
        if (sql.includes("overview-top-products")) {
          return [];
        }
        if (sql.includes("overview-completed-movement")) {
          return [
            {
              facet: "unit",
              kind: "receipt",
              warehouseId: "wh-1",
              baseUnitName: "cái",
              qty: "80.0000",
              day: null,
            },
            {
              facet: "unit",
              kind: "receipt",
              warehouseId: "wh-1",
              baseUnitName: "kg",
              qty: "20.0000",
              day: null,
            },
            {
              facet: "unit",
              kind: "issue",
              warehouseId: "wh-1",
              baseUnitName: "cái",
              qty: "50.0000",
              day: null,
            },
            {
              facet: "day",
              kind: "receipt",
              warehouseId: null,
              baseUnitName: "",
              qty: "60.0000",
              day: new Date("2026-08-10T00:00:00.000Z"),
            },
            {
              facet: "day",
              kind: "issue",
              warehouseId: null,
              baseUnitName: "",
              qty: "30.0000",
              day: new Date("2026-08-10T00:00:00.000Z"),
            },
          ];
        }
        return [];
      },
    );
  });

  it("returns organization-wide overview for admin", async () => {
    mockPrisma.stockReceipt.groupBy.mockResolvedValue([
      { warehouseId: "wh-1", status: "completed", _count: { _all: 5 } },
      { warehouseId: "wh-1", status: "draft", _count: { _all: 2 } },
    ]);

    const { organizationOverviewService } =
      await import("../../src/modules/report/organization-overview.service");
    const ctx = organizationOverviewService.buildContext(
      "tenant-1",
      "admin-user",
      "admin",
      "all",
    );
    const data = await organizationOverviewService.getOverview(ctx, {
      from: "2026-08-09T00:00:00.000Z",
      to: "2026-08-11T00:00:00.000Z",
    });

    expect(data.visibilityScope).toBe("organization");
    expect(data.organization.warehouseCount).toBe(1);
    expect(data.documents.stockReceipts.total).toBe(7);
    expect(data.documents.stockReceipts.byStatus.completed).toBe(5);
    expect(data.productMovement.totalImportedQty).toBe("100.0000");
    expect(data.productMovement.totalExportedQty).toBe("50.0000");
    expect(data.productMovement.importedQtyByUnit).toEqual([
      { baseUnitName: "cái", qty: "80.0000" },
      { baseUnitName: "kg", qty: "20.0000" },
    ]);
    expect(data.productMovement.exportedQtyByUnit).toEqual([
      { baseUnitName: "cái", qty: "50.0000" },
    ]);
    expect(data.productMovement.dailyMovement).toEqual([
      { date: "2026-08-09", importedQty: "0.0000", exportedQty: "0.0000" },
      { date: "2026-08-10", importedQty: "60.0000", exportedQty: "30.0000" },
      { date: "2026-08-11", importedQty: "0.0000", exportedQty: "0.0000" },
    ]);
    expect(data.inventory.qtyByUnit).toEqual([]);
    expect(
      data.warehousesBreakdown[0].productMovement.importedQtyByUnit,
    ).toEqual([
      { baseUnitName: "cái", qty: "80.0000" },
      { baseUnitName: "kg", qty: "20.0000" },
    ]);
    expect(mockCache.set).toHaveBeenCalled();
    expect(mockPrisma.stockReservation.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.stockReservation.findMany).not.toHaveBeenCalled();
  });

  it("scopes warehouse_keeper to own documents only", async () => {
    mockPrisma.stockReceipt.groupBy.mockResolvedValue([
      { status: "completed", _count: { _all: 3 } },
    ]);

    const { organizationOverviewService } =
      await import("../../src/modules/report/organization-overview.service");
    const ctx = organizationOverviewService.buildContext(
      "tenant-1",
      "keeper-user",
      "warehouse_keeper",
      ["wh-1"],
    );
    const data = await organizationOverviewService.getOverview(ctx, {});

    expect(data.visibilityScope).toBe("own_documents");
    expect(data.inventory).toBeNull();
    expect(data.warehousesBreakdown).toEqual([]);
    expect(data.productMovement.importedQtyByUnit).toEqual([
      { baseUnitName: "cái", qty: "80.0000" },
      { baseUnitName: "kg", qty: "20.0000" },
    ]);
    expect(mockPrisma.stockReceipt.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ createdById: "keeper-user" }, { approvedById: "keeper-user" }],
        }),
      }),
    );
  });
});
