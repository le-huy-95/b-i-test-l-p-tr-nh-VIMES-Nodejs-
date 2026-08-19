-- Drop product pricing-rule fields and keep product profile focused on core inventory data.
ALTER TABLE "products"
  DROP COLUMN IF EXISTS "track_batch",
  DROP COLUMN IF EXISTS "track_expiry",
  DROP COLUMN IF EXISTS "costing_method",
  DROP COLUMN IF EXISTS "picking_priority";

DROP TYPE IF EXISTS "CostingMethod";
DROP TYPE IF EXISTS "PickingPriority";
