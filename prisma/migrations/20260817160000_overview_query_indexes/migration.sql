-- Overview API indexes: completed qty, own-document filters, top products, expiry, reservation expiry.

CREATE INDEX IF NOT EXISTS "stock_receipts_tenant_id_status_completed_at_idx"
  ON "stock_receipts" ("tenant_id", "status", "completed_at");

CREATE INDEX IF NOT EXISTS "stock_receipts_tenant_id_created_by_id_idx"
  ON "stock_receipts" ("tenant_id", "created_by_id");

CREATE INDEX IF NOT EXISTS "stock_receipts_tenant_id_approved_by_id_idx"
  ON "stock_receipts" ("tenant_id", "approved_by_id");

CREATE INDEX IF NOT EXISTS "stock_issues_tenant_id_status_completed_at_idx"
  ON "stock_issues" ("tenant_id", "status", "completed_at");

CREATE INDEX IF NOT EXISTS "stock_issues_tenant_id_created_by_id_idx"
  ON "stock_issues" ("tenant_id", "created_by_id");

CREATE INDEX IF NOT EXISTS "stock_issues_tenant_id_approved_by_id_idx"
  ON "stock_issues" ("tenant_id", "approved_by_id");

CREATE INDEX IF NOT EXISTS "stock_receipt_details_product_id_idx"
  ON "stock_receipt_details" ("product_id");

CREATE INDEX IF NOT EXISTS "stock_issue_details_product_id_idx"
  ON "stock_issue_details" ("product_id");

CREATE INDEX IF NOT EXISTS "batches_tenant_id_warehouse_id_expiry_date_idx"
  ON "batches" ("tenant_id", "warehouse_id", "expiry_date");

CREATE INDEX IF NOT EXISTS "stock_reservations_tenant_id_status_expires_at_idx"
  ON "stock_reservations" ("tenant_id", "status", "expires_at");
