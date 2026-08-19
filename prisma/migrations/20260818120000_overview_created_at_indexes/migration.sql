-- Date-range overview: document counts filter created_at; ledger detail filters warehouse + created_at.

CREATE INDEX IF NOT EXISTS "stock_opening_balances_tenant_id_created_at_idx"
  ON "stock_opening_balances" ("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "stock_receipts_tenant_id_created_at_idx"
  ON "stock_receipts" ("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "stock_issues_tenant_id_created_at_idx"
  ON "stock_issues" ("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "stock_ledgers_tenant_id_warehouse_id_created_at_idx"
  ON "stock_ledgers" ("tenant_id", "warehouse_id", "created_at");
