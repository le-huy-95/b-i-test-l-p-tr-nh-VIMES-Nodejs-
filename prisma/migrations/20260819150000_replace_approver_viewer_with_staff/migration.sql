-- Replace approver and viewer roles with staff
ALTER TYPE "TenantRole" ADD VALUE IF NOT EXISTS 'staff';

-- Migrate existing data: approver -> accountant, viewer -> staff
UPDATE "user_tenants" SET "role" = 'accountant' WHERE "role" = 'approver';
UPDATE "user_tenants" SET "role" = 'staff' WHERE "role" = 'viewer';
UPDATE "invitations" SET "role" = 'staff' WHERE "role" = 'viewer';
UPDATE "invitations" SET "role" = 'accountant' WHERE "role" = 'approver';

-- Change defaults
ALTER TABLE "user_tenants" ALTER COLUMN "role" SET DEFAULT 'staff';
ALTER TABLE "invitations" ALTER COLUMN "role" SET DEFAULT 'staff';

-- Remove old enum values (PostgreSQL requires recreating the type)
-- Step 1: Remove defaults temporarily
ALTER TABLE "user_tenants" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "invitations" ALTER COLUMN "role" DROP DEFAULT;

-- Step 2: Create new enum type
CREATE TYPE "TenantRole_new" AS ENUM ('admin', 'warehouse_keeper', 'accountant', 'staff');

-- Step 3: Alter columns to use new type
ALTER TABLE "user_tenants" ALTER COLUMN "role" TYPE "TenantRole_new" USING ("role"::text::"TenantRole_new");
ALTER TABLE "invitations" ALTER COLUMN "role" TYPE "TenantRole_new" USING ("role"::text::"TenantRole_new");

-- Step 4: Drop old type and rename new
DROP TYPE "TenantRole";
ALTER TYPE "TenantRole_new" RENAME TO "TenantRole";

-- Step 5: Restore defaults
ALTER TABLE "user_tenants" ALTER COLUMN "role" SET DEFAULT 'staff';
ALTER TABLE "invitations" ALTER COLUMN "role" SET DEFAULT 'staff';
