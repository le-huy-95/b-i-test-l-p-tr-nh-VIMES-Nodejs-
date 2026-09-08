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
  warehouse: { findMany: vi.fn(), findFirst: vi.fn() },
  stockIssue: { groupBy: vi.fn(), findMany: vi.fn() },
  stockReceipt: { groupBy: vi.fn(), findMany: vi.fn() },
  stockOpeningBalance: { groupBy: vi.fn() },
  product: { findMany: vi.fn() },
  stockBalance: { findMany: vi.fn() },
  stockReservation: {
    findMany: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  batch: { findMany: vi.fn() },
  stockLedger: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
};

vi.mock("../../src/infra/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../src/infra/redis-list-cache", () => ({
  listCache: mockCache,
}));

describe("warehouse overview service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCache.get.mockResolvedValue(null);
  });

  it("returns cached warehouse overview detail without hitting db", async () => {
    const cached = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      warehouse: { id: "wh-1" },
    };
    mockCache.get.mockResolvedValueOnce(cached);

    const { warehouseOverviewService } =
      await import("../../src/modules/report/warehouse-overview.service");
    const data = await warehouseOverviewService.detail("tenant-1", "wh-1", {});

    expect(data).toEqual(cached);
    expect(mockPrisma.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it("builds warehouse overview detail for a warehouse", async () => {
    mockPrisma.warehouse.findFirst.mockResolvedValue({
      id: "wh-1",
      code: "WH01",
      name: "Kho chính",
      address: "123 ABC",
      isActive: true,
      latitude: null,
      longitude: null,
    });
    mockPrisma.stockIssue.groupBy.mockResolvedValue([
      { status: "pending_approval", _count: { _all: 2 } },
      { status: "completed", _count: { _all: 10 } },
    ]);
    mockPrisma.stockReceipt.groupBy.mockResolvedValue([
      { status: "draft", _count: { _all: 1 } },
    ]);
    mockPrisma.stockOpeningBalance.groupBy.mockResolvedValue([]);
    mockPrisma.stockIssue.findMany.mockResolvedValue([
      {
        id: "issue-1",
        code: "PX001",
        issueDate: new Date("2026-08-01"),
        issueType: "sale",
        createdAt: new Date("2026-08-01T08:00:00.000Z"),
        customer: { id: "cust-1", code: "KH01", name: "Khách A" },
      },
    ]);
    mockPrisma.stockReceipt.findMany.mockResolvedValue([]);
    mockPrisma.stockLedger.findMany.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: "product-1",
        sku: "SKU-1",
        name: "Widget",
        baseUnitName: "cái",
        minStockLevel: "10.0000",
        averageCost: "100.0000",
      },
    ]);
    mockPrisma.stockBalance.findMany.mockResolvedValue([
      { productId: "product-1", batchId: null, onhandQty: "12.0000" },
    ]);
    mockPrisma.stockReservation.findMany.mockResolvedValue([]);
    mockPrisma.batch.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        skuCount: 1,
        totalOnhandQty: "12.0000",
        totalReservedQty: "0",
        totalAvailableQty: "12.0000",
        estimatedStockValue: "1200.00",
        lowStockCount: 0,
        expiryAlertCount: 0,
        activeReservationCount: 0,
        qtyByUnit: [
          {
            baseUnitName: "cái",
            onhandQty: "12.0000",
            reservedQty: "0.0000",
            availableQty: "12.0000",
          },
        ],
      },
    ]);

    const { warehouseOverviewService } =
      await import("../../src/modules/report/warehouse-overview.service");
    const data = await warehouseOverviewService.detail("tenant-1", "wh-1", {});

    expect(data.warehouse.code).toBe("WH01");
    expect(data.inventory.skuCount).toBe(1);
    expect(data.inventory.estimatedStockValue).toBe("1200.00");
    expect(data.inventory.qtyByUnit).toEqual([
      {
        baseUnitName: "cái",
        onhandQty: "12.0000",
        reservedQty: "0.0000",
        availableQty: "12.0000",
      },
    ]);
    expect(data.stockIssues.byStatus.pending_approval).toBe(2);
    expect(data.stockIssues.pendingApproval).toHaveLength(1);
    expect(mockCache.set).toHaveBeenCalled();
    expect(mockPrisma.stockReservation.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when warehouse does not belong to tenant", async () => {
    mockPrisma.warehouse.findFirst.mockResolvedValue(null);

    const { warehouseOverviewService } =
      await import("../../src/modules/report/warehouse-overview.service");
    await expect(
      warehouseOverviewService.detail("tenant-1", "missing", {}),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
  });

  it("applies from/to date filters to document and movement queries", async () => {
    mockPrisma.warehouse.findFirst.mockResolvedValue({
      id: "wh-1",
      code: "WH01",
      name: "Kho chính",
      address: null,
      isActive: true,
      latitude: null,
      longitude: null,
    });
    mockPrisma.stockIssue.groupBy.mockResolvedValue([]);
    mockPrisma.stockReceipt.groupBy.mockResolvedValue([]);
    mockPrisma.stockOpeningBalance.groupBy.mockResolvedValue([]);
    mockPrisma.stockIssue.findMany.mockResolvedValue([]);
    mockPrisma.stockReceipt.findMany.mockResolvedValue([]);
    mockPrisma.stockLedger.findMany.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.stockBalance.findMany.mockResolvedValue([]);
    mockPrisma.stockReservation.findMany.mockResolvedValue([]);
    mockPrisma.batch.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        skuCount: 0,
        totalOnhandQty: "0",
        totalReservedQty: "0",
        totalAvailableQty: "0",
        estimatedStockValue: "0.00",
        lowStockCount: 0,
        expiryAlertCount: 0,
        activeReservationCount: 0,
        qtyByUnit: [],
      },
    ]);

    const { warehouseOverviewService } =
      await import("../../src/modules/report/warehouse-overview.service");
    await warehouseOverviewService.detail("tenant-1", "wh-1", {
      from: "2026-08-01",
      to: "2026-08-31",
    });

    const expectedDateFilter = {
      createdAt: {
        gte: new Date("2026-08-01"),
        lte: new Date("2026-08-31"),
      },
    };

    expect(mockPrisma.stockIssue.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-1",
          warehouseId: "wh-1",
          ...expectedDateFilter,
        },
      }),
    );
    expect(mockPrisma.stockLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-1",
          warehouseId: "wh-1",
          ...expectedDateFilter,
        },
      }),
    );
    expect(mockCache.set).toHaveBeenCalledWith(
      expect.stringContaining("2026-08-01"),
      expect.objectContaining({
        filters: {
          from: "2026-08-01",
          to: "2026-08-31",
          expiryDays: 30,
          recentLimit: 5,
        },
      }),
    );
  });
});
