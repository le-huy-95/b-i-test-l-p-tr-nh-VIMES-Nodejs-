import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockIssueService } from "../../src/modules/stock-issue/stock-issue.service";
import { AppError } from "../../src/utils/app-error";

describe("stock issue list/get visibility", () => {
  const findMany = vi.fn();
  const findFirst = vi.fn();
  const count = vi.fn();
  const workflowFindMany = vi.fn();
  const cacheGetOrSet = vi.fn(async (_key: string, loader: () => Promise<unknown>) =>
    loader(),
  );

  const db = {
    stockIssue: { findMany, findFirst, count },
    documentWorkflowStep: { findMany: workflowFindMany },
  } as any;

  const cache = { getOrSet: cacheGetOrSet } as any;
  const service = new StockIssueService(db, {} as any, cache);

  beforeEach(() => {
    vi.clearAllMocks();
    cacheGetOrSet.mockImplementation(async (_key, loader) => loader());
  });

  it("lists all issues for admin without workflow lookup", async () => {
    findMany.mockResolvedValue([{ id: "i1" }, { id: "i2" }]);

    const result = await service.list("tenant-1", {
      userId: "admin-1",
      role: "admin",
    });

    expect(workflowFindMany).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-1" },
      }),
    );
    expect(result).toEqual([{ id: "i1" }, { id: "i2" }]);
    expect(cacheGetOrSet.mock.calls[0][0]).toContain(":org:");
  });

  it("filters staff list by creator, approver, or workflow assignment", async () => {
    workflowFindMany.mockResolvedValue([{ documentId: "i-workflow" }]);
    findMany.mockResolvedValue([{ id: "i-mine" }]);

    await service.list("tenant-1", { userId: "staff-1", role: "staff" });

    expect(workflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          documentType: "stock_issue",
        }),
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-1",
          OR: [
            { createdById: "staff-1" },
            { approvedById: "staff-1" },
            { id: { in: ["i-workflow"] } },
          ],
        },
      }),
    );
    expect(cacheGetOrSet.mock.calls[0][0]).toContain(":user:staff-1:");
  });

  it("returns 404 when staff gets unrelated issue", async () => {
    workflowFindMany.mockResolvedValue([]);
    findFirst.mockResolvedValue(null);

    await expect(
      service.get("tenant-1", "secret", { userId: "staff-1", role: "staff" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<AppError>);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "secret",
          tenantId: "tenant-1",
          OR: [{ createdById: "staff-1" }, { approvedById: "staff-1" }],
        },
      }),
    );
  });
});
