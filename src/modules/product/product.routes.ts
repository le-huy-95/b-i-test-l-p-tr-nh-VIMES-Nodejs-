import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth";
import { requireRoles, tenantMiddleware } from "../../middlewares/tenant";
import { idempotencyMiddleware } from "../../middlewares/idempotency";
import { asyncHandler } from "../../middlewares/errorHandler";
import { productController } from "./product.controller";

const router = Router();
router.use(authMiddleware, tenantMiddleware, idempotencyMiddleware);

const canManageProducts = requireRoles("admin", "accountant", "warehouse_keeper");

router.get("/", asyncHandler(productController.list));
router.post("/", canManageProducts, asyncHandler(productController.create));
router.get("/:id/availability", asyncHandler(productController.availability));
router.get("/:id", asyncHandler(productController.get));
router.put("/:id", canManageProducts, asyncHandler(productController.update));
router.delete(
  "/:id",
  canManageProducts,
  asyncHandler(productController.softDelete),
);

export default router;
