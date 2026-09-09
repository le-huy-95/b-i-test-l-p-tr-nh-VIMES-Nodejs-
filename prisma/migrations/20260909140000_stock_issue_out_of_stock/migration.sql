-- AlterEnum
ALTER TYPE "DocStatus" ADD VALUE 'out_of_stock';
ALTER TYPE "NotificationType" ADD VALUE 'issue_out_of_stock';
ALTER TYPE "NotificationType" ADD VALUE 'issue_stock_available';

-- AlterTable
ALTER TABLE "stock_issues" ADD COLUMN "status_before_out_of_stock" "DocStatus",
ADD COLUMN "out_of_stock_at" TIMESTAMP(3),
ADD COLUMN "out_of_stock_reason" TEXT;
