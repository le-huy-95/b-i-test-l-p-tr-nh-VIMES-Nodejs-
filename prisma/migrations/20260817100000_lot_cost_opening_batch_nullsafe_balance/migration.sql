-- AlterTable
ALTER TABLE "batches" ADD COLUMN "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_opening_balance_details" ADD COLUMN "batch_id" TEXT;
ALTER TABLE "stock_opening_balance_details" ADD COLUMN "batch_no" TEXT;
ALTER TABLE "stock_opening_balance_details" ADD COLUMN "expiry_date" DATE;

-- AddForeignKey
ALTER TABLE "stock_opening_balance_details" ADD CONSTRAINT "stock_opening_balance_details_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Replace NULL-unsafe unique (Postgres treats NULLs as distinct) with coalesced unique
DROP INDEX IF EXISTS "stock_balances_tenant_id_product_id_warehouse_id_batch_id_l_key";
CREATE UNIQUE INDEX "stock_balances_unique_nullsafe_key"
  ON "stock_balances" ("tenant_id", "product_id", "warehouse_id", COALESCE("batch_id", ''), COALESCE("location_id", ''));
