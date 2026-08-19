-- CreateEnum
CREATE TYPE "PickingPriority" AS ENUM ('fefo', 'fifo', 'none');
CREATE TYPE "ReceiptType" AS ENUM ('purchase', 'customer_return', 'transfer_in', 'production_output', 'other');
CREATE TYPE "CostingMethod_new" AS ENUM ('fifo', 'weighted_average', 'specific_identification');

-- Products: split costing vs picking
ALTER TABLE "products" ADD COLUMN "picking_priority" "PickingPriority" NOT NULL DEFAULT 'none';
ALTER TABLE "products" ADD COLUMN "costing_method_new" "CostingMethod_new" NOT NULL DEFAULT 'weighted_average';

UPDATE "products" SET
  "costing_method_new" = CASE "costing_method"::text
    WHEN 'FIFO' THEN 'fifo'::"CostingMethod_new"
    WHEN 'FEFO' THEN CASE
      WHEN "track_batch" THEN 'fifo'::"CostingMethod_new"
      ELSE 'weighted_average'::"CostingMethod_new"
    END
    ELSE 'weighted_average'::"CostingMethod_new"
  END,
  "picking_priority" = CASE
    WHEN "costing_method"::text = 'FEFO' OR "track_expiry" = true THEN 'fefo'::"PickingPriority"
    WHEN "track_batch" = true THEN 'fifo'::"PickingPriority"
    ELSE 'none'::"PickingPriority"
  END;

ALTER TABLE "products" DROP COLUMN "costing_method";
DROP TYPE "CostingMethod";
ALTER TYPE "CostingMethod_new" RENAME TO "CostingMethod";
ALTER TABLE "products" RENAME COLUMN "costing_method_new" TO "costing_method";
ALTER TABLE "products" ALTER COLUMN "costing_method" SET DEFAULT 'weighted_average';

-- Receipt type
ALTER TABLE "stock_receipts" ADD COLUMN "receipt_type" "ReceiptType" NOT NULL DEFAULT 'purchase';

-- Line / reservation batch references
ALTER TABLE "stock_receipt_details" ADD COLUMN "batch_id" TEXT;
ALTER TABLE "stock_issue_details" ADD COLUMN "batch_id" TEXT;
ALTER TABLE "stock_reservations" ADD COLUMN "batch_id" TEXT;

CREATE INDEX "stock_reservations_tenant_id_product_id_warehouse_id_batch_id_status_idx"
  ON "stock_reservations"("tenant_id", "product_id", "warehouse_id", "batch_id", "status");

-- Reservation expired status (not used in this migration's DML)
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'expired';

-- Batch master
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "batch_no" TEXT NOT NULL,
    "manufacture_date" DATE,
    "expiry_date" DATE,
    "supplier_id" TEXT,
    "receipt_detail_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "batches_tenant_id_product_id_batch_no_key" ON "batches"("tenant_id", "product_id", "batch_no");
CREATE INDEX "batches_tenant_id_product_id_expiry_date_idx" ON "batches"("tenant_id", "product_id", "expiry_date");

ALTER TABLE "batches" ADD CONSTRAINT "batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batches" ADD CONSTRAINT "batches_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "batches" ADD CONSTRAINT "batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
