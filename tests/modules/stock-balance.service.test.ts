import { afterEach, describe, expect, it, vi } from "vitest";

describe("stock balance service", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function stubCoreEnv() {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/test_db",
    );
    vi.stubEnv("JWT_ACCESS_SECRET", "access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "refresh-secret");
  }

  it("computes available quantity from on-hand minus reservations", async () => {
    stubCoreEnv();
    const { stockBalanceService } =
      await import("../../src/modules/stock-balance/stock-balance.service");

    const trx = {
      stockBalance: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ onhandQty: "12.5" }, { onhandQty: "7.5" }]),
      },
      stockReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { qtyBaseUnit: "5" } }),
      },
    } as never;

    await expect(
      stockBalanceService.getAvailable("tenant-1", "product-1", "wh-1", trx),
    ).resolves.toMatchObject({
      onhandQty: expect.any(Object),
      reservedQty: expect.any(Object),
      availableQty: expect.any(Object),
    });

    const result = await stockBalanceService.getAvailable(
      "tenant-1",
      "product-1",
      "wh-1",
      trx,
    );
    expect(result.onhandQty.toString()).toBe("20");
    expect(result.reservedQty.toString()).toBe("5");
    expect(result.availableQty.toString()).toBe("15");
  });

  it("creates and increments balances in applyIncrease", async () => {
    stubCoreEnv();
    const { stockBalanceService } =
      await import("../../src/modules/stock-balance/stock-balance.service");

    const created = { id: "balance-1", onhandQty: "3" };
    const updated = { id: "balance-2", onhandQty: "8" };
    const trx = {
      stockBalance: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "balance-2" }),
        create: vi.fn().mockResolvedValue(created),
        update: vi.fn().mockResolvedValue(updated),
      },
    } as never;

    const result = await stockBalanceService.applyIncrease(
      [
        {
          tenantId: "tenant-1",
          productId: "p2",
          warehouseId: "w1",
          qtyBaseUnit: "5",
        },
        {
          tenantId: "tenant-1",
          productId: "p1",
          warehouseId: "w1",
          qtyBaseUnit: "3",
        },
      ],
      trx,
    );

    expect(result).toHaveLength(2);
    expect(result[0].key.productId).toBe("p1");
    expect(result[0].balanceAfter).toBe("3");
    expect(result[1].key.productId).toBe("p2");
    expect(result[1].balanceAfter).toBe("8");
  });

  it("rejects applyDecrease when stock is insufficient", async () => {
    stubCoreEnv();
    const { stockBalanceService } =
      await import("../../src/modules/stock-balance/stock-balance.service");

    const trx = {
      stockBalance: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "balance-1", onhandQty: "2", version: 1 }),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    } as never;

    await expect(
      stockBalanceService.applyDecrease(
        [
          {
            tenantId: "tenant-1",
            productId: "p1",
            warehouseId: "w1",
            qtyBaseUnit: "5",
          },
        ],
        trx,
      ),
    ).rejects.toMatchObject({
      name: "AppError",
      code: "STOCK_INSUFFICIENT",
      statusCode: 409,
      details: [{ productId: "p1", available: "2", requested: "5" }],
    });
  });

  it("resolves quantity in base unit using product conversion rates", async () => {
    stubCoreEnv();
    const { resolveQtyBaseUnit } =
      await import("../../src/modules/stock-balance/qty");

    const trx = {
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          baseUnitName: "cái",
          units: [
            { unitName: "thùng", conversionRate: "12" },
            { unitName: "cái", conversionRate: "1" },
          ],
        }),
      },
    } as never;

    await expect(resolveQtyBaseUnit("p1", "thùng", 2, trx)).resolves.toBe(
      "24.0000",
    );
  });
});
