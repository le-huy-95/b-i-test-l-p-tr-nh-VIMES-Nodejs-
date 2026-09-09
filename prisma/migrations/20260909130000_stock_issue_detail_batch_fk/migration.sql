-- AlterTable
ALTER TABLE "stock_issue_details"
  ADD CONSTRAINT "stock_issue_details_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
