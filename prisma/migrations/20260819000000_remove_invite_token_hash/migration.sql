-- DropIndex
DROP INDEX "invitations_token_hash_key";

-- AlterTable
ALTER TABLE "invitations" DROP COLUMN "token_hash";
