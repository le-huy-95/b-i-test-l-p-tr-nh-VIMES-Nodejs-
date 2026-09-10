import { describe, expect, it } from "vitest";
import {
  STOCK_DOC_FULL_ACCESS_ROLES,
  buildRelatedDocumentWhere,
  buildRelatedWorkflowWhere,
  resolveStockDocVisibilityScope,
  stockDocListCacheVisibilityKey,
} from "../../src/modules/stock-balance/stock-doc-visibility";

describe("stock-doc-visibility", () => {
  it("grants organization scope to admin, warehouse_keeper, accountant", () => {
    expect(STOCK_DOC_FULL_ACCESS_ROLES).toEqual([
      "admin",
      "warehouse_keeper",
      "accountant",
    ]);
    expect(resolveStockDocVisibilityScope("admin")).toBe("organization");
    expect(resolveStockDocVisibilityScope("warehouse_keeper")).toBe(
      "organization",
    );
    expect(resolveStockDocVisibilityScope("accountant")).toBe("organization");
  });

  it("limits staff to related_documents scope", () => {
    expect(resolveStockDocVisibilityScope("staff")).toBe("related_documents");
  });

  it("builds related where with creator, approver, and workflow document ids", () => {
    expect(buildRelatedDocumentWhere("user-1", ["doc-a", "doc-b"])).toEqual({
      OR: [
        { createdById: "user-1" },
        { approvedById: "user-1" },
        { id: { in: ["doc-a", "doc-b"] } },
      ],
    });
  });

  it("builds related workflow where from step assignee/signer fields", () => {
    expect(buildRelatedWorkflowWhere("user-1")).toEqual({
      steps: {
        some: {
          OR: [
            { assignedApproverId: "user-1" },
            { requiredSignerId: "user-1" },
            { actualSignerId: "user-1" },
          ],
        },
      },
    });
  });

  it("omits id filter when there are no workflow-related documents", () => {
    expect(buildRelatedDocumentWhere("user-1", [])).toEqual({
      OR: [{ createdById: "user-1" }, { approvedById: "user-1" }],
    });
  });

  it("scopes list cache keys by org vs user", () => {
    expect(stockDocListCacheVisibilityKey("organization", "user-1")).toBe(
      "org",
    );
    expect(stockDocListCacheVisibilityKey("related_documents", "user-1")).toBe(
      "user:user-1",
    );
  });
});
