/**
 * Tạo 10 sản phẩm đầy đủ thông tin cho tenant ANC (kho long châu - mã kho 124).
 *
 * Usage:
 *   bun run db:seed:longchau          (hoặc npx tsx scripts/seed-products-longchau.ts)
 *
 * Sản phẩm thuộc tenant (không gắn trực tiếp vào kho theo schema Product).
 * Script cũng tạo stock_balances cho kho long châu để sản phẩm có tồn đầu.
 *
 * Env: DATABASE_URL (từ .env)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, TenantStatus } from '../src/generated/prisma';
import { Pool } from 'pg';

const TENANT_CODE = 'ANC';
const WAREHOUSE_CODE = 'kho 124';

interface ProductSeed {
  sku: string;
  barcode: string;
  name: string;
  baseUnitName: string;
  minStockLevel: number;
  maxStockLevel: number;
  reorderPoint: number;
  averageCost: number;
  onhandQty: number;
  units: { unitName: string; conversionRate: number }[];
}

const PRODUCTS: ProductSeed[] = [
  {
    sku: 'LC-PARACETAMOL-500',
    barcode: '8934567891001',
    name: 'Paracetamol 500mg hộp 10 vỉ x 10 viên',
    baseUnitName: 'hộp',
    minStockLevel: 50,
    maxStockLevel: 500,
    reorderPoint: 80,
    averageCost: 8500,
    onhandQty: 120,
    units: [
      { unitName: 'hộp', conversionRate: 1 },
      { unitName: 'vỉ', conversionRate: 10 },
    ],
  },
  {
    sku: 'LC-AMOXICILLIN-500',
    barcode: '8934567891002',
    name: 'Amoxicillin 500mg hộp 20 viên',
    baseUnitName: 'hộp',
    minStockLevel: 30,
    maxStockLevel: 300,
    reorderPoint: 50,
    averageCost: 22000,
    onhandQty: 65,
    units: [
      { unitName: 'hộp', conversionRate: 1 },
      { unitName: 'viên', conversionRate: 20 },
    ],
  },
  {
    sku: 'LC-VITAMINC-500',
    barcode: '8934567891003',
    name: 'Vitamin C 500mg chai 100 viên',
    baseUnitName: 'chai',
    minStockLevel: 40,
    maxStockLevel: 400,
    reorderPoint: 60,
    averageCost: 48000,
    onhandQty: 90,
    units: [
      { unitName: 'chai', conversionRate: 1 },
      { unitName: 'viên', conversionRate: 100 },
    ],
  },
  {
    sku: 'LC-OMEPRAZOLE-20',
    barcode: '8934567891004',
    name: 'Omeprazole 20mg hộp 14 viên',
    baseUnitName: 'hộp',
    minStockLevel: 40,
    maxStockLevel: 350,
    reorderPoint: 55,
    averageCost: 32000,
    onhandQty: 85,
    units: [
      { unitName: 'hộp', conversionRate: 1 },
      { unitName: 'viên', conversionRate: 14 },
    ],
  },
  {
    sku: 'LC-CETIRIZINE-10',
    barcode: '8934567891005',
    name: 'Cetirizine 10mg hộp 30 viên',
    baseUnitName: 'hộp',
    minStockLevel: 30,
    maxStockLevel: 250,
    reorderPoint: 45,
    averageCost: 18000,
    onhandQty: 70,
    units: [
      { unitName: 'hộp', conversionRate: 1 },
      { unitName: 'viên', conversionRate: 30 },
    ],
  },
  {
    sku: 'LC-METFORMIN-850',
    barcode: '8934567891006',
    name: 'Metformin 850mg hộp 30 viên',
    baseUnitName: 'hộp',
    minStockLevel: 25,
    maxStockLevel: 200,
    reorderPoint: 40,
    averageCost: 25000,
    onhandQty: 55,
    units: [
      { unitName: 'hộp', conversionRate: 1 },
      { unitName: 'viên', conversionRate: 30 },
    ],
  },
  {
    sku: 'LC-ORS-ORALIT',
    barcode: '8934567891007',
    name: 'Oresol Oralit gói 27,5g (túi 10 gói)',
    baseUnitName: 'túi',
    minStockLevel: 60,
    maxStockLevel: 600,
    reorderPoint: 90,
    averageCost: 32000,
    onhandQty: 140,
    units: [
      { unitName: 'túi', conversionRate: 1 },
      { unitName: 'gói', conversionRate: 10 },
    ],
  },
  {
    sku: 'LC-BERBERIN-10',
    barcode: '8934567891008',
    name: 'Berberin 10mg chai 100 viên',
    baseUnitName: 'chai',
    minStockLevel: 35,
    maxStockLevel: 300,
    reorderPoint: 50,
    averageCost: 15000,
    onhandQty: 78,
    units: [
      { unitName: 'chai', conversionRate: 1 },
      { unitName: 'viên', conversionRate: 100 },
    ],
  },
  {
    sku: 'LC-CANXI-D3',
    barcode: '8934567891009',
    name: 'Calcium + Vitamin D3 hộp 30 viên',
    baseUnitName: 'hộp',
    minStockLevel: 30,
    maxStockLevel: 250,
    reorderPoint: 45,
    averageCost: 55000,
    onhandQty: 48,
    units: [
      { unitName: 'hộp', conversionRate: 1 },
      { unitName: 'viên', conversionRate: 30 },
    ],
  },
  {
    sku: 'LC-KHAU-TRANG-YTE',
    barcode: '8934567891010',
    name: 'Khẩu trang y tế 4 lớp (hộp 50 cái)',
    baseUnitName: 'hộp',
    minStockLevel: 80,
    maxStockLevel: 800,
    reorderPoint: 120,
    averageCost: 25000,
    onhandQty: 200,
    units: [
      { unitName: 'hộp', conversionRate: 1 },
      { unitName: 'cái', conversionRate: 50 },
    ],
  },
];

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

async function main(): Promise<void> {
  const { prisma, pool } = createPrisma();

  try {
    const tenant = await prisma.tenant.findFirst({
      where: { code: TENANT_CODE, status: TenantStatus.active },
    });
    if (!tenant) {
      throw new Error(`Không tìm thấy tenant có code "${TENANT_CODE}"`);
    }

    const warehouse = await prisma.warehouse.findFirst({
      where: { tenantId: tenant.id, code: WAREHOUSE_CODE },
    });
    if (!warehouse) {
      throw new Error(
        `Không tìm thấy kho "${WAREHOUSE_CODE}" của tenant "${TENANT_CODE}". Kho hiện có: kho 124 (kho long châu)`,
      );
    }

    const existingSkus = await prisma.product.findMany({
      where: { tenantId: tenant.id, sku: { in: PRODUCTS.map((p) => p.sku) } },
      select: { sku: true },
    });
    const existingSet = new Set(existingSkus.map((p) => p.sku));

    let created = 0;
    let skipped = 0;

    for (const seed of PRODUCTS) {
      if (existingSet.has(seed.sku)) {
        console.log(`  - Bỏ qua (SKU đã tồn tại): ${seed.sku}`);
        skipped += 1;
        continue;
      }

      const product = await prisma.product.create({
        data: {
          tenantId: tenant.id,
          sku: seed.sku,
          barcode: seed.barcode,
          name: seed.name,
          baseUnitName: seed.baseUnitName,
          minStockLevel: seed.minStockLevel,
          maxStockLevel: seed.maxStockLevel,
          reorderPoint: seed.reorderPoint,
          averageCost: seed.averageCost,
          units: { create: seed.units },
        },
      });

      await prisma.stockBalance.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          warehouseId: warehouse.id,
          onhandQty: seed.onhandQty,
        },
      });

      console.log(
        `  + Đã tạo: ${seed.sku} | ${seed.name} | tồn ${seed.onhandQty} ${seed.baseUnitName}`,
      );
      created += 1;
    }

    console.log('');
    console.log('Hoàn tất.');
    console.log(`  Tenant: ${tenant.code} (${tenant.id})`);
    console.log(`  Warehouse: ${warehouse.code} - ${warehouse.name} (${warehouse.id})`);
    console.log(`  Đã tạo: ${created} sản phẩm`);
    console.log(`  Đã bỏ qua: ${skipped} sản phẩm`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed thất bại:', err);
  process.exit(1);
});
