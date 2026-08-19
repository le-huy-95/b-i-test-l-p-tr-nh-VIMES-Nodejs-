/**
 * Tạo tổ chức + dữ liệu nghiệp vụ mẫu cho một user (theo email).
 *
 * Usage:
 *   bun run scripts/seed-user-org.ts lehuy2606it@gmail.com
 *   bun run scripts/seed-user-org.ts lehuy2606it@gmail.com --reset
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

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const shouldReset = process.argv.includes('--reset');
const email = args[0];

if (!email) {
  console.error('Usage: bun run scripts/seed-user-org.ts <email> [--reset]');
  process.exit(1);
}

const TENANT_CODE = 'LEHUY';

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
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

async function resetTenant(prisma: PrismaClient, tenantId: string): Promise<void> {
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
    prisma.userTenant.deleteMany({ where: { tenantId } }),
    prisma.tenant.delete({ where: { id: tenantId } }),
  ]);
}

async function seedBusinessData(
  tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  tenantId: string,
  actorId: string,
): Promise<void> {
  const year = new Date().getFullYear();
  const effectiveDate = daysAgo(30);
  const receiptDate = daysAgo(7);
  const issueDate = daysAgo(3);

  await tx.numberingCounter.createMany({
    data: [
      { tenantId, docType: 'stock_opening', year, prefix: 'TDK', currentValue: 1n },
      { tenantId, docType: 'stock_receipt', year, prefix: 'PNK', currentValue: 3n },
      { tenantId, docType: 'stock_issue', year, prefix: 'PXK', currentValue: 2n },
    ],
  });

  const [warehouseHn, warehouseHcm] = await Promise.all([
    tx.warehouse.create({
      data: {
        tenantId,
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
        tenantId,
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
        tenantId,
        code: 'NCC-001',
        name: 'Công ty TNHH Thực phẩm Miền Bắc',
        taxCode: '0101234567',
        contact: 'Nguyễn Văn A - 0901234567',
      },
    }),
    tx.supplier.create({
      data: {
        tenantId,
        code: 'NCC-002',
        name: 'Công ty CP Hóa mỹ phẩm Sài Gòn',
        taxCode: '0312345678',
        contact: 'Trần Thị B - 0912345678',
      },
    }),
  ]);

  const customers = await Promise.all([
    tx.customer.create({
      data: {
        tenantId,
        code: 'KH-001',
        name: 'Siêu thị Co.opMart Hà Nội',
        phone: '0241234567',
        email: 'hanoi@coopmart.vn',
      },
    }),
    tx.customer.create({
      data: {
        tenantId,
        code: 'KH-002',
        name: 'Cửa hàng tiện lợi FamilyMart Q1',
        phone: '0287654321',
        email: 'q1@familymart.vn',
      },
    }),
  ]);

  const deptSales = await tx.department.create({
    data: { tenantId, code: 'PB-BH', name: 'Phòng Kinh doanh' },
  });
  await tx.department.createMany({
    data: [
      { tenantId, code: 'PB-KHO', name: 'Phòng Kho vận' },
      { tenantId, code: 'PB-BH-HN', name: 'Kinh doanh Miền Bắc', parentDepartmentId: deptSales.id },
      { tenantId, code: 'PB-KT', name: 'Phòng Kế toán' },
    ],
  });

  const productRice = await tx.product.create({
    data: {
      tenantId,
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
      tenantId,
      sku: 'SP-DAU-NEPTUNE',
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

  const productMilk = await tx.product.create({
    data: {
      tenantId,
      sku: 'SP-SUA-TH',
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
      tenantId,
      code: `TDK-${year}-000001`,
      effectiveDate,
      warehouseId: warehouseHn.id,
      status: DocStatus.completed,
      note: 'Tồn đầu kỳ',
      createdById: actorId,
      approvedById: actorId,
      postedAt: effectiveDate,
      details: {
        create: [
          { productId: productRice.id, qtyBaseUnit: 500, unitCost: 18000 },
          { productId: productOil.id, qtyBaseUnit: 120, unitCost: 41000 },
        ],
      },
    },
  });

  const receiptCompleted = await tx.stockReceipt.create({
    data: {
      tenantId,
      code: `PNK-${year}-000001`,
      receiptDate,
      warehouseId: warehouseHn.id,
      supplierId: suppliers[0].id,
      status: DocStatus.completed,
      totalAmount: 3038000,
      note: 'Nhập hàng đợt 1',
      createdById: actorId,
      approvedById: actorId,
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
            expectedQty: 98,
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

  const issueCompleted = await tx.stockIssue.create({
    data: {
      tenantId,
      code: `PXK-${year}-000001`,
      issueDate,
      warehouseId: warehouseHn.id,
      issueType: IssueType.sale,
      customerId: customers[0].id,
      status: DocStatus.completed,
      note: 'Xuất bán cho Co.opMart',
      createdById: actorId,
      approvedById: actorId,
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
        ],
      },
    },
  });

  const riceOnHand = 500 + 250 - 100;
  const oilOnHand = 120;
  const milkOnHand = 98;

  await tx.stockBalance.createMany({
    data: [
      { tenantId, productId: productRice.id, warehouseId: warehouseHn.id, onhandQty: riceOnHand },
      { tenantId, productId: productOil.id, warehouseId: warehouseHn.id, onhandQty: oilOnHand },
      { tenantId, productId: productMilk.id, warehouseId: warehouseHn.id, onhandQty: milkOnHand },
    ],
  });

  await tx.stockLedger.createMany({
    data: [
      {
        tenantId,
        productId: productRice.id,
        warehouseId: warehouseHn.id,
        transactionType: LedgerTxnType.opening,
        refDocType: 'stock_opening',
        refDocId: opening.id,
        qtyChange: 500,
        qtyBalanceAfter: 500,
        unitCost: 18000,
        createdById: actorId,
        createdAt: effectiveDate,
      },
      {
        tenantId,
        productId: productOil.id,
        warehouseId: warehouseHn.id,
        transactionType: LedgerTxnType.opening,
        refDocType: 'stock_opening',
        refDocId: opening.id,
        qtyChange: 120,
        qtyBalanceAfter: 120,
        unitCost: 41000,
        createdById: actorId,
        createdAt: effectiveDate,
      },
      {
        tenantId,
        productId: productRice.id,
        warehouseId: warehouseHn.id,
        transactionType: LedgerTxnType.in,
        refDocType: 'stock_receipt',
        refDocId: receiptCompleted.id,
        qtyChange: 250,
        qtyBalanceAfter: 750,
        unitCost: 18000,
        createdById: actorId,
        createdAt: receiptDate,
      },
      {
        tenantId,
        productId: productMilk.id,
        warehouseId: warehouseHn.id,
        transactionType: LedgerTxnType.in,
        refDocType: 'stock_receipt',
        refDocId: receiptCompleted.id,
        qtyChange: 98,
        qtyBalanceAfter: 98,
        unitCost: 31000,
        createdById: actorId,
        createdAt: receiptDate,
      },
      {
        tenantId,
        productId: productRice.id,
        warehouseId: warehouseHn.id,
        transactionType: LedgerTxnType.out,
        refDocType: 'stock_issue',
        refDocId: issueCompleted.id,
        qtyChange: -100,
        qtyBalanceAfter: riceOnHand,
        unitCost: 18500,
        createdById: actorId,
        createdAt: issueDate,
      },
    ],
  });

  await tx.stockReservation.create({
    data: {
      tenantId,
      productId: productMilk.id,
      warehouseId: warehouseHn.id,
      refDocType: 'stock_issue',
      refDocId: issueCompleted.id,
      qtyBaseUnit: 10,
      status: ReservationStatus.active,
      expiresAt: daysFromNow(1),
    },
  });

  console.log(`  Kho: ${warehouseHn.code}, ${warehouseHcm.code}`);
  console.log(`  NCC: ${suppliers.length}, KH: ${customers.length}, SP: 3`);
  console.log(`  Phiếu: opening=1, receipt=1, issue=1`);
}

async function main(): Promise<void> {
  const { prisma, pool } = createPrisma();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new Error(`Không tìm thấy user với email: ${email}`);
    }
    if (!user.emailVerifiedAt && !user.phoneVerifiedAt) {
      throw new Error('User chưa xác minh email/phone');
    }

    const existing = await prisma.tenant.findUnique({ where: { code: TENANT_CODE } });

    if (existing) {
      const membership = await prisma.userTenant.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId: existing.id } },
      });

      if (shouldReset) {
        await resetTenant(prisma, existing.id);
        console.log(`Đã xóa tenant "${TENANT_CODE}" để seed lại.`);
      } else if (membership) {
        console.log(`User đã thuộc tenant "${TENANT_CODE}" (${existing.id}). Dùng --reset để seed lại.`);
        return;
      } else {
        await prisma.userTenant.create({
          data: { userId: user.id, tenantId: existing.id, role: 'admin' },
        });
        console.log(`Đã gán user admin cho tenant "${TENANT_CODE}" (${existing.id}).`);
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          code: TENANT_CODE,
          name: 'Công ty Le Huy',
          status: TenantStatus.active,
          userTenants: {
            create: { userId: user.id, role: 'admin' },
          },
        },
      });

      await seedBusinessData(tx, tenant.id, user.id);

      console.log('Tạo tổ chức thành công.');
      console.log(`  User: ${user.email} (${user.id})`);
      console.log(`  Tenant: ${tenant.code} — ${tenant.name} (${tenant.id})`);
      console.log(`  Role: admin`);
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Thất bại:', err);
  process.exit(1);
});
