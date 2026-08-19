import { Router } from 'express';
import healthRoutes from './health.routes';
import authRoutes from '../modules/auth/auth.routes';
import tenantRoutes from '../modules/tenant/tenant.routes';
import warehouseRoutes from '../modules/warehouse/warehouse.routes';
import productRoutes from '../modules/product/product.routes';
import supplierRoutes from '../modules/supplier/supplier.routes';
import customerRoutes from '../modules/customer/customer.routes';
import stockOpeningRoutes from '../modules/stock-opening/stock-opening.routes';
import stockReceiptRoutes from '../modules/stock-receipt/stock-receipt.routes';
import stockIssueRoutes from '../modules/stock-issue/stock-issue.routes';
import reportRoutes from '../modules/report/report.routes';
import documentWorkflowRoutes from '../modules/document-workflow/document-workflow.routes';
import fileRoutes from '../modules/file/file.routes';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/tenants/current', tenantRoutes);
router.use('/warehouses', warehouseRoutes);
router.use('/products', productRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/customers', customerRoutes);
router.use('/stock-opening-balances', stockOpeningRoutes);
router.use('/stock-receipts', stockReceiptRoutes);
router.use('/stock-issues', stockIssueRoutes);
router.use('/reports', reportRoutes);
router.use('/document-workflows', documentWorkflowRoutes);
router.use('/files', fileRoutes);

export default router;
