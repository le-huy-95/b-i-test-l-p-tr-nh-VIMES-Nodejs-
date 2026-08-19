/**
 * Seed dữ liệu mẫu cho các bảng nghiệp vụ (không tạo User / auth).
 *
 * Usage:
 *   bun run db:seed
 *   bun run db:seed -- --reset
 *
 * Env: DATABASE_URL (từ .env)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  DocStatus,
  IssueType,
  LedgerTxnType,
  ReservationStatus,
  TenantStatus,
} from '../src/generated/prisma';
import { Pool } from 'pg';

const TENANT_CODE = 'DEMO';
const SEED_ACTOR_ID = 'seed-system';

const args = process.argv.slice(2);
const shouldReset = args.includes('--reset');

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  return url;
}

function createPrisma(): { prisma: PrismaClient; pool: Pool } {
  const pool = new Pool({ connectionString: requireDatabaseUrl() });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function resetDemoTenant(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.tenant.findUnique({ where: { code: TENANT_CODE } });
  if (!existing) return;

  const tenantId = existing.id;

  await prisma.$transaction([
    prisma.stockLedger.deleteMany({ where: { tenantId } }),
    prisma.stockReservation.deleteMany({ where: { tenantId } }),
    prisma.stockBalance.deleteMany({ where: { tenantId } }),
    prisma.stockIssueDetail.deleteMany({ where: { issue: { tenantId } } }),
    prisma.stockIssue.deleteMany({ where: { tenantId } }),
    prisma.stockReceiptDetail.deleteMany({ where: { receipt: { tenantId } } }),
    prisma.stockReceipt.deleteMany({ where: { tenantId } }),
    prisma.stockOpeningBalanceDetail.deleteMany({ where: { openingBalance: { tenantId } } }),
    prisma.stockOpeningBalance.deleteMany({ where: { tenantId } }),
    prisma.productUnit.deleteMany({ where: { product: { tenantId } } }),
    prisma.product.deleteMany({ where: { tenantId } }),
    prisma.supplier.deleteMany({ where: { tenantId } }),
    prisma.customer.deleteMany({ where: { tenantId } }),
    prisma.department.deleteMany({ where: { tenantId } }),
    prisma.warehouse.deleteMany({ where: { tenantId } }),
    prisma.numberingCounter.deleteMany({ where: { tenantId } }),
    prisma.tenant.delete({ where: { id: tenantId } }),
  ]);

  console.log(`Đã xóa tenant "${TENANT_CODE}" và toàn bộ dữ liệu liên quan.`);
}

async function seed(): Promise<void> {
  const { prisma, pool } = createPrisma();

  try {
    if (shouldReset) {
      await resetDemoTenant(prisma);
    } else {
      const existing = await prisma.tenant.findUnique({ where: { code: TENANT_CODE } });
      if (existing) {
        console.log(
          `Tenant "${TENANT_CODE}" đã tồn tại. Dùng --reset để xóa và seed lại:\n  bun run db:seed -- --reset`,
        );
        return;
      }
    }

    const year = new Date().getFullYear();
    const effectiveDate = daysAgo(30);
    const receiptDate = daysAgo(7);
    const issueDate = daysAgo(3);

    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          code: TENANT_CODE,
          name: 'Công ty Demo Kho Vận',
          status: TenantStatus.active,
        },
      });

      await tx.numberingCounter.createMany({
        data: [
          { tenantId: tenant.id, docType: 'stock_opening', year, prefix: 'TDK', currentValue: 1n },
          { tenantId: tenant.id, docType: 'stock_receipt', year, prefix: 'PNK', currentValue: 3n },
          { tenantId: tenant.id, docType: 'stock_issue', year, prefix: 'PXK', currentValue: 2n },
        ],
      });

      const [warehouseHn, warehouseHcm] = await Promise.all([
        tx.warehouse.create({
          data: {
            tenantId: tenant.id,
            code: 'KHO-HN',
            name: 'Kho Hà Nội',
            address: '123 Phố Huế, Hai Bà Trưng, Hà Nội',
            latitude: 21.0123,
            longitude: 105.8567,
            geoSource: 'manual',
            geocodeStatus: 'success',
          },
        }),
        tx.warehouse.create({
          data: {
            tenantId: tenant.id,
            code: 'KHO-HCM',
            name: 'Kho TP.HCM',
            address: '456 Nguyễn Văn Cừ, Quận 5, TP.HCM',
            latitude: 10.762,
            longitude: 106.682,
            geoSource: 'manual',
            geocodeStatus: 'success',
          },
        }),
      ]);

      const suppliers = await Promise.all([
        tx.supplier.create({
          data: {
            tenantId: tenant.id,
            code: 'NCC-001',
            name: 'Công ty TNHH Thực phẩm Miền Bắc',
            taxCode: '0101234567',
            contact: 'Nguyễn Văn A - 0901234567',
          },
        }),
        tx.supplier.create({
          data: {
            tenantId: tenant.id,
            code: 'NCC-002',
            name: 'Công ty CP Hóa mỹ phẩm Sài Gòn',
            taxCode: '0312345678',
            contact: 'Trần Thị B - 0912345678',
          },
        }),
        tx.supplier.create({
          data: {
            tenantId: tenant.id,
            code: 'NCC-003',
            name: 'Nhà cung cấp Nông sản ĐBSCL',
            taxCode: '1400123456',
            contact: 'Lê Văn C - 0923456789',
          },
        }),
      ]);

      const customers = await Promise.all([
        tx.customer.create({
          data: {
            tenantId: tenant.id,
            code: 'KH-001',
            name: 'Siêu thị Co.opMart Hà Nội',
            phone: '0241234567',
            email: 'hanoi@coopmart.vn',
          },
        }),
        tx.customer.create({
          data: {
            tenantId: tenant.id,
            code: 'KH-002',
            name: 'Cửa hàng tiện lợi FamilyMart Q1',
            phone: '0287654321',
            email: 'q1@familymart.vn',
          },
        }),
        tx.customer.create({
          data: {
            tenantId: tenant.id,
            code: 'KH-003',
            name: 'Nhà hàng Phở 24',
            phone: '0908765432',
          },
        }),
      ]);

      const deptSales = await tx.department.create({
        data: { tenantId: tenant.id, code: 'PB-BH', name: 'Phòng Kinh doanh' },
      });
      await tx.department.createMany({
        data: [
          { tenantId: tenant.id, code: 'PB-KHO', name: 'Phòng Kho vận' },
          {
            tenantId: tenant.id,
            code: 'PB-BH-HN',
            name: 'Kinh doanh Miền Bắc',
            parentDepartmentId: deptSales.id,
          },
          { tenantId: tenant.id, code: 'PB-KT', name: 'Phòng Kế toán' },
        ],
      });

      const productRice = await tx.product.create({
        data: {
          tenantId: tenant.id,
          sku: 'SP-GAO-ST25',
          barcode: '8934567890123',
          name: 'Gạo ST25 túi 5kg',
          baseUnitName: 'kg',
          minStockLevel: 100,
          reorderPoint: 200,
          maxStockLevel: 2000,
          averageCost: 18500,
          units: {
            create: [
              { unitName: 'kg', conversionRate: 1 },
              { unitName: 'túi', conversionRate: 5 },
            ],
          },
        },
      });

      const productOil = await tx.product.create({
        data: {
          tenantId: tenant.id,
          sku: 'SP-DAU-NEPTUNE',
          barcode: '8934567890124',
          name: 'Dầu ăn Neptune 1L',
          baseUnitName: 'chai',
          minStockLevel: 50,
          reorderPoint: 100,
          averageCost: 42000,
          units: {
            create: [
              { unitName: 'chai', conversionRate: 1 },
              { unitName: 'thùng', conversionRate: 12 },
            ],
          },
        },
      });

      const productFishSauce = await tx.product.create({
        data: {
          tenantId: tenant.id,
          sku: 'SP-NM-NAMNGU',
          name: 'Nước mắm Nam Ngư 750ml',
          baseUnitName: 'chai',
          minStockLevel: 30,
          averageCost: 28000,
          units: { create: [{ unitName: 'chai', conversionRate: 1 }] },
        },
      });

      const productDetergent = await tx.product.create({
        data: {
          tenantId: tenant.id,
          sku: 'SP-BG-OMO',
          name: 'Bột giặt OMO 3kg',
          baseUnitName: 'hộp',
          minStockLevel: 20,
          averageCost: 95000,
          units: { create: [{ unitName: 'hộp', conversionRate: 1 }] },
        },
      });

      const productMilk = await tx.product.create({
        data: {
          tenantId: tenant.id,
          sku: 'SP-SUA-TH',
          barcode: '8934567890125',
          name: 'Sữa tươi TH 1L',
          baseUnitName: 'hộp',
          minStockLevel: 40,
          reorderPoint: 80,
          averageCost: 32000,
          units: { create: [{ unitName: 'hộp', conversionRate: 1 }] },
        },
      });

      const opening = await tx.stockOpeningBalance.create({
        data: {
          tenantId: tenant.id,
          code: `TDK-${year}-000001`,
          effectiveDate,
          warehouseId: warehouseHn.id,
          status: DocStatus.completed,
          note: 'Tồn đầu kỳ tháng 1',
          createdById: SEED_ACTOR_ID,
          approvedById: SEED_ACTOR_ID,
          postedAt: effectiveDate,
          details: {
            create: [
              { productId: productRice.id, qtyBaseUnit: 500, unitCost: 18000 },
              { productId: productOil.id, qtyBaseUnit: 120, unitCost: 41000 },
              { productId: productFishSauce.id, qtyBaseUnit: 80, unitCost: 27000 },
            ],
          },
        },
      });

      const receiptCompleted = await tx.stockReceipt.create({
        data: {
          tenantId: tenant.id,
          code: `PNK-${year}-000001`,
          receiptDate,
          warehouseId: warehouseHn.id,
          supplierId: suppliers[0].id,
          sourceDocType: 'PO',
          sourceDocNo: 'PO-2026-001',
          deliveredByName: 'Nguyễn Văn Giao',
          status: DocStatus.completed,
          totalAmount: 4250000,
          note: 'Nhập hàng đợt 1 tháng 8',
          createdById: SEED_ACTOR_ID,
          approvedById: SEED_ACTOR_ID,
          approvedAt: receiptDate,
          completedAt: receiptDate,
          details: {
            create: [
              {
                productId: productRice.id,
                unitName: 'túi',
                expectedQty: 50,
                actualQty: 50,
                qtyBaseUnit: 250,
                unitPrice: 90000,
                lineAmount: 4500000,
                batchNo: 'LOT-20260801',
                expiryDate: daysFromNow(180),
              },
              {
                productId: productMilk.id,
                unitName: 'hộp',
                expectedQty: 100,
                actualQty: 98,
                qtyBaseUnit: 98,
                unitPrice: 31000,
                lineAmount: 3038000,
                expiryDate: daysFromNow(14),
              },
            ],
          },
        },
      });

      await tx.stockReceipt.create({
        data: {
          tenantId: tenant.id,
          code: `PNK-${year}-000002`,
          receiptDate: new Date(),
          warehouseId: warehouseHcm.id,
          supplierId: suppliers[1].id,
          status: DocStatus.draft,
          totalAmount: 1900000,
          note: 'Phiếu nhập đang soạn thảo',
          createdById: SEED_ACTOR_ID,
          details: {
            create: [
              {
                productId: productDetergent.id,
                unitName: 'hộp',
                expectedQty: 20,
                actualQty: 20,
                qtyBaseUnit: 20,
                unitPrice: 95000,
                lineAmount: 1900000,
              },
            ],
          },
        },
      });

      await tx.stockReceipt.create({
        data: {
          tenantId: tenant.id,
          code: `PNK-${year}-000003`,
          receiptDate: daysAgo(1),
          warehouseId: warehouseHn.id,
          supplierId: suppliers[2].id,
          status: DocStatus.pending_approval,
          totalAmount: 840000,
          createdById: SEED_ACTOR_ID,
          details: {
            create: [
              {
                productId: productFishSauce.id,
                unitName: 'chai',
                expectedQty: 30,
                actualQty: 30,
                qtyBaseUnit: 30,
                unitPrice: 28000,
                lineAmount: 840000,
              },
            ],
          },
        },
      });

      const issueCompleted = await tx.stockIssue.create({
        data: {
          tenantId: tenant.id,
          code: `PXK-${year}-000001`,
          issueDate,
          warehouseId: warehouseHn.id,
          issueType: IssueType.sale,
          customerId: customers[0].id,
          status: DocStatus.completed,
          note: 'Xuất bán cho Co.opMart',
          createdById: SEED_ACTOR_ID,
          approvedById: SEED_ACTOR_ID,
          approvedAt: issueDate,
          completedAt: issueDate,
          details: {
            create: [
              {
                productId: productRice.id,
                unitName: 'túi',
                requestedQty: 20,
                actualQty: 20,
                qtyBaseUnit: 100,
                unitPrice: 95000,
              },
              {
                productId: productOil.id,
                unitName: 'thùng',
                requestedQty: 5,
                actualQty: 5,
                qtyBaseUnit: 60,
                unitPrice: 480000,
              },
            ],
          },
        },
      });

      const issueDraft = await tx.stockIssue.create({
        data: {
          tenantId: tenant.id,
          code: `PXK-${year}-000002`,
          issueDate: new Date(),
          warehouseId: warehouseHn.id,
          issueType: IssueType.internal_use,
          status: DocStatus.draft,
          note: 'Xuất nội bộ phòng hành chính',
          createdById: SEED_ACTOR_ID,
          details: {
            create: [
              {
                productId: productDetergent.id,
                unitName: 'hộp',
                requestedQty: 2,
                actualQty: 2,
                qtyBaseUnit: 2,
                unitPrice: 0,
              },
            ],
          },
        },
      });

      // Tồn kho sau opening + receipt - issue (kho HN)
      const riceOnHand = 500 + 250 - 100; // 650
      const oilOnHand = 120 + 0 - 60; // 60
      const fishSauceOnHand = 80 + 0; // 80 (receipt pending chưa hoàn thành)
      const milkOnHand = 98;

      await tx.stockBalance.createMany({
        data: [
          {
            tenantId: tenant.id,
            productId: productRice.id,
            warehouseId: warehouseHn.id,
            onhandQty: riceOnHand,
          },
          {
            tenantId: tenant.id,
            productId: productOil.id,
            warehouseId: warehouseHn.id,
            onhandQty: oilOnHand,
          },
          {
            tenantId: tenant.id,
            productId: productFishSauce.id,
            warehouseId: warehouseHn.id,
            onhandQty: fishSauceOnHand,
          },
          {
            tenantId: tenant.id,
            productId: productMilk.id,
            warehouseId: warehouseHn.id,
            onhandQty: milkOnHand,
          },
        ],
      });

      await tx.stockLedger.createMany({
        data: [
          {
            tenantId: tenant.id,
            productId: productRice.id,
            warehouseId: warehouseHn.id,
            transactionType: LedgerTxnType.opening,
            refDocType: 'stock_opening',
            refDocId: opening.id,
            qtyChange: 500,
            qtyBalanceAfter: 500,
            unitCost: 18000,
            createdById: SEED_ACTOR_ID,
            createdAt: effectiveDate,
          },
          {
            tenantId: tenant.id,
            productId: productOil.id,
            warehouseId: warehouseHn.id,
            transactionType: LedgerTxnType.opening,
            refDocType: 'stock_opening',
            refDocId: opening.id,
            qtyChange: 120,
            qtyBalanceAfter: 120,
            unitCost: 41000,
            createdById: SEED_ACTOR_ID,
            createdAt: effectiveDate,
          },
          {
            tenantId: tenant.id,
            productId: productRice.id,
            warehouseId: warehouseHn.id,
            transactionType: LedgerTxnType.in,
            refDocType: 'stock_receipt',
            refDocId: receiptCompleted.id,
            qtyChange: 250,
            qtyBalanceAfter: 750,
            unitCost: 18000,
            createdById: SEED_ACTOR_ID,
            createdAt: receiptDate,
          },
          {
            tenantId: tenant.id,
            productId: productMilk.id,
            warehouseId: warehouseHn.id,
            transactionType: LedgerTxnType.in,
            refDocType: 'stock_receipt',
            refDocId: receiptCompleted.id,
            qtyChange: 98,
            qtyBalanceAfter: 98,
            unitCost: 31000,
            createdById: SEED_ACTOR_ID,
            createdAt: receiptDate,
          },
          {
            tenantId: tenant.id,
            productId: productRice.id,
            warehouseId: warehouseHn.id,
            transactionType: LedgerTxnType.out,
            refDocType: 'stock_issue',
            refDocId: issueCompleted.id,
            qtyChange: -100,
            qtyBalanceAfter: riceOnHand,
            unitCost: 18500,
            createdById: SEED_ACTOR_ID,
            createdAt: issueDate,
          },
          {
            tenantId: tenant.id,
            productId: productOil.id,
            warehouseId: warehouseHn.id,
            transactionType: LedgerTxnType.out,
            refDocType: 'stock_issue',
            refDocId: issueCompleted.id,
            qtyChange: -60,
            qtyBalanceAfter: oilOnHand,
            unitCost: 42000,
            createdById: SEED_ACTOR_ID,
            createdAt: issueDate,
          },
        ],
      });

      await tx.stockReservation.create({
        data: {
          tenantId: tenant.id,
          productId: productMilk.id,
          warehouseId: warehouseHn.id,
          refDocType: 'stock_issue',
          refDocId: issueDraft.id,
          qtyBaseUnit: 10,
          status: ReservationStatus.active,
          expiresAt: daysFromNow(1),
        },
      });

      console.log('Seed hoàn tất.');
      console.log(`  Tenant: ${tenant.code} (${tenant.id})`);
      console.log(`  Kho: ${warehouseHn.code}, ${warehouseHcm.code}`);
      console.log(`  NCC: ${suppliers.length}, KH: ${customers.length}, SP: 5`);
      console.log(`  Phiếu: opening=1, receipt=3, issue=2`);
      console.log(`  (Bỏ qua: users, user_tenants, refresh_tokens, otp_codes, invitations, send_email_logs)`);
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed thất bại:', err);
  process.exit(1);
});
