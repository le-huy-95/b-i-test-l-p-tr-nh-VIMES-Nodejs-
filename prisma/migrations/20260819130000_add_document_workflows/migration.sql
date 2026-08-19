-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('stock_issue', 'stock_receipt', 'stock_opening');

-- CreateEnum
CREATE TYPE "WorkflowStepStatus" AS ENUM ('pending', 'approved', 'rejected', 'signed_by_proxy', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "WorkflowDocumentStatus" AS ENUM ('draft', 'in_review', 'approved', 'rejected', 'cancelled', 'completed');

-- CreateTable
CREATE TABLE "document_workflows" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "document_id" TEXT NOT NULL,
    "status" "WorkflowDocumentStatus" NOT NULL DEFAULT 'draft',
    "current_step_code" TEXT,
    "current_step_status" "WorkflowStepStatus",
    "current_step_updated_at" TIMESTAMP(3),
    "last_action_by_id" TEXT,
    "last_action_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_workflow_steps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "document_id" TEXT NOT NULL,
    "step_code" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "required_role" "TenantRole",
    "required_signer_id" TEXT,
    "assigned_approver_id" TEXT,
    "actual_signer_id" TEXT,
    "authorized_signer_id" TEXT,
    "status" "WorkflowStepStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "action_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_step_authorizations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "file_id" TEXT,
    "file_url" TEXT,
    "file_name" TEXT,
    "authorization_no" TEXT,
    "issued_by" TEXT,
    "issued_at" TIMESTAMP(3),
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_step_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workflow_id" TEXT,
    "document_type" "DocumentType" NOT NULL,
    "document_id" TEXT NOT NULL,
    "step_id" TEXT,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "changed_by_id" TEXT NOT NULL,
    "changed_by_role" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_workflows_tenant_id_document_type_status_idx" ON "document_workflows"("tenant_id", "document_type", "status");

-- CreateIndex
CREATE INDEX "document_workflows_tenant_id_status_updated_at_idx" ON "document_workflows"("tenant_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "document_workflows_tenant_id_last_action_by_id_idx" ON "document_workflows"("tenant_id", "last_action_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_workflows_document_type_document_id_key" ON "document_workflows"("document_type", "document_id");

-- CreateIndex
CREATE INDEX "document_workflow_steps_tenant_id_workflow_id_sequence_idx" ON "document_workflow_steps"("tenant_id", "workflow_id", "sequence");

-- CreateIndex
CREATE INDEX "document_workflow_steps_tenant_id_assigned_approver_id_stat_idx" ON "document_workflow_steps"("tenant_id", "assigned_approver_id", "status");

-- CreateIndex
CREATE INDEX "document_workflow_steps_tenant_id_required_signer_id_status_idx" ON "document_workflow_steps"("tenant_id", "required_signer_id", "status");

-- CreateIndex
CREATE INDEX "document_workflow_steps_tenant_id_document_type_status_idx" ON "document_workflow_steps"("tenant_id", "document_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_workflow_steps_workflow_id_step_code_key" ON "document_workflow_steps"("workflow_id", "step_code");

-- CreateIndex
CREATE INDEX "document_step_authorizations_tenant_id_step_id_idx" ON "document_step_authorizations"("tenant_id", "step_id");

-- CreateIndex
CREATE INDEX "document_step_authorizations_tenant_id_workflow_id_idx" ON "document_step_authorizations"("tenant_id", "workflow_id");

-- CreateIndex
CREATE INDEX "document_step_authorizations_tenant_id_document_id_idx" ON "document_step_authorizations"("tenant_id", "document_id");

-- CreateIndex
CREATE INDEX "document_status_history_tenant_id_document_id_changed_at_idx" ON "document_status_history"("tenant_id", "document_id", "changed_at");

-- CreateIndex
CREATE INDEX "document_status_history_tenant_id_workflow_id_changed_at_idx" ON "document_status_history"("tenant_id", "workflow_id", "changed_at");

-- CreateIndex
CREATE INDEX "document_status_history_tenant_id_step_id_changed_at_idx" ON "document_status_history"("tenant_id", "step_id", "changed_at");

-- CreateIndex
CREATE INDEX "document_status_history_tenant_id_document_type_changed_at_idx" ON "document_status_history"("tenant_id", "document_type", "changed_at");

-- AddForeignKey
ALTER TABLE "document_workflows" ADD CONSTRAINT "document_workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_workflow_steps" ADD CONSTRAINT "document_workflow_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_workflow_steps" ADD CONSTRAINT "document_workflow_steps_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "document_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_step_authorizations" ADD CONSTRAINT "document_step_authorizations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_step_authorizations" ADD CONSTRAINT "document_step_authorizations_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "document_workflow_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_step_authorizations" ADD CONSTRAINT "document_step_authorizations_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "document_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_status_history" ADD CONSTRAINT "document_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_status_history" ADD CONSTRAINT "document_status_history_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "document_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
