-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "declined_at" TIMESTAMP(3);

-- RenameIndex
ALTER INDEX "stock_reservations_tenant_id_product_id_warehouse_id_batch_id_s" RENAME TO "stock_reservations_tenant_id_product_id_warehouse_id_batch__idx";
