/**
 * HÀM HỖ TRỢ DÒNG PHIẾU KHO
 * -------------------------
 * Validate và map dòng chi tiết phiếu nhập/xuất/tồn đầu kỳ.
 */
import type { Prisma, PrismaClient } from '../../infra/prisma-types';
import { AppError } from '../../utils/app-error';
import { d, toDecimalString } from '../../utils/decimal';
import { ensureBatch } from './batch.service';

export interface StockReceiptInputLine {
  productId: string;
  unitName: string;
  expectedQty: number;
  actualQty: number;
  unitPrice: number;
  batchNo?: string;
  expiryDate?: string;
}

export interface StockReceiptLineDetail {
  productId: string;
  unitName: string;
  expectedQty: number;
  actualQty: number;
  qtyBaseUnit: string;
  unitPrice: number;
  lineAmount: string;
  batchNo?: string;
  expiryDate?: Date;
}

export interface StockIssueInputLine {
  productId: string;
  unitName: string;
  requestedQty: number;
  actualQty: number;
  unitPrice?: number;
  batchId?: string;
}

export interface StockIssueLineDetail {
  productId: string;
  unitName: string;
  requestedQty: number;
  actualQty: number;
  qtyBaseUnit: string;
  unitPrice: number;
  batchId?: string;
}

export interface StockOpeningDetailInput {
  id: string;
  productId: string;
  batchId: string | null;
  batchNo: string | null;
  expiryDate: Date | null;
  qtyBaseUnit: { toString(): string };
  unitCost: { toString(): string };
}

export interface StockReceiptCompletionDetail {
  id: string;
  productId: string;
  qtyBaseUnit: { toString(): string };
  unitPrice: { toString(): string };
  batchId: string | null;
  batchNo: string | null;
  expiryDate: Date | null;
}

export interface StockReceiptCompletionDoc {
  warehouse_id: string;
  supplier_id: string | null;
}

type StockDbClient = PrismaClient | Prisma.TransactionClient;

type ProductWithUnits = {
  id: string;
  baseUnitName: string;
  units: Array<{ unitName: string; conversionRate: { toString(): string } | string | number }>;
};

function resolveQtyFromProduct(product: ProductWithUnits, unitName: string, qty: number): string {
  const unit = product.units.find((item) => item.unitName === unitName)
    ?? product.units.find((item) => item.unitName === product.baseUnitName);
  const rate = d(unit?.conversionRate?.toString() ?? 1);
  return toDecimalString(d(qty).mul(rate), 4);
}

export async function resolveQtyBaseUnit(
  productId: string,
  unitName: string,
  qty: number,
  db: StockDbClient,
): Promise<string> {
  const product = await db.product.findUniqueOrThrow({
    where: { id: productId },
    include: { units: true },
  });
  return resolveQtyFromProduct(product, unitName, qty);
}

export async function buildStockReceiptDetails(
  db: StockDbClient,
  lines: StockReceiptInputLine[],
): Promise<{ details: StockReceiptLineDetail[]; total: ReturnType<typeof d> }> {
  const productIds = [...new Set(lines.map((line) => line.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    include: { units: true },
  });
  const productMap = new Map(products.map((product) => [product.id, product]));

  const details: StockReceiptLineDetail[] = [];
  let total = d(0);

  for (const line of lines) {
    const product = productMap.get(line.productId);
    if (!product) {
      throw new AppError('NOT_FOUND', 404, 'Product not found');
    }
    const qtyBaseUnit = resolveQtyFromProduct(product, line.unitName, line.actualQty);
    const lineAmount = toDecimalString(d(line.actualQty).mul(line.unitPrice), 2);
    total = total.plus(lineAmount);
    details.push({
      productId: line.productId,
      unitName: line.unitName,
      expectedQty: line.expectedQty,
      actualQty: line.actualQty,
      qtyBaseUnit,
      unitPrice: line.unitPrice,
      lineAmount,
      batchNo: line.batchNo,
      expiryDate: line.expiryDate ? new Date(line.expiryDate) : undefined,
    });
  }

  return { details, total };
}

export async function buildStockIssueDetails(
  db: StockDbClient,
  lines: StockIssueInputLine[],
): Promise<StockIssueLineDetail[]> {
  const productIds = [...new Set(lines.map((line) => line.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    include: { units: true },
  });
  const productMap = new Map(products.map((product) => [product.id, product]));

  const details: StockIssueLineDetail[] = [];

  for (const line of lines) {
    const product = productMap.get(line.productId);
    if (!product) {
      throw new AppError('NOT_FOUND', 404, 'Product not found');
    }
    const qtyBaseUnit = resolveQtyFromProduct(product, line.unitName, line.actualQty);
    details.push({
      productId: line.productId,
      unitName: line.unitName,
      requestedQty: line.requestedQty,
      actualQty: line.actualQty,
      qtyBaseUnit,
      unitPrice: line.unitPrice ?? 0,
      batchId: line.batchId,
    });
  }

  return details;
}

export async function buildStockOpeningChanges(
  trx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  details: StockOpeningDetailInput[],
): Promise<Array<{
  tenantId: string;
  productId: string;
  warehouseId: string;
  batchId: string | null;
  qtyBaseUnit: string;
  unitCost: string;
}>> {
  const changes: Array<{
    tenantId: string;
    productId: string;
    warehouseId: string;
    batchId: string | null;
    qtyBaseUnit: string;
    unitCost: string;
  }> = [];

  for (const line of details) {
    let batchId: string | null = line.batchId;
    if (line.batchNo) {
      batchId = await ensureBatch(trx, {
        tenantId,
        productId: line.productId,
        batchNo: line.batchNo,
        warehouseId,
        expiryDate: line.expiryDate,
        unitCost: line.unitCost.toString(),
      });
      await trx.stockOpeningBalanceDetail.update({
        where: { id: line.id },
        data: { batchId },
      });
    }

    changes.push({
      tenantId,
      productId: line.productId,
      warehouseId,
      batchId,
      qtyBaseUnit: line.qtyBaseUnit.toString(),
      unitCost: line.unitCost.toString(),
    });
  }

  return changes;
}

export async function buildStockReceiptChanges(
  trx: Prisma.TransactionClient,
  tenantId: string,
  receipt: StockReceiptCompletionDoc,
  details: StockReceiptCompletionDetail[],
): Promise<Array<{
  tenantId: string;
  productId: string;
  warehouseId: string;
  batchId: string | null;
  qtyBaseUnit: string;
  unitCost: string;
}>> {
  const grouped = new Map<
    string,
    { productId: string; batchId: string | null; qty: ReturnType<typeof d>; unitCost: ReturnType<typeof d> }
  >();

  for (const line of details) {
    let batchId: string | null = line.batchId;
    if (line.batchNo) {
      batchId = await ensureBatch(trx, {
        tenantId,
        productId: line.productId,
        batchNo: line.batchNo,
        warehouseId: receipt.warehouse_id,
        expiryDate: line.expiryDate,
        supplierId: receipt.supplier_id,
        receiptDetailId: line.id,
        unitCost: line.unitPrice.toString(),
      });
      await trx.stockReceiptDetail.update({
        where: { id: line.id },
        data: { batchId },
      });
    }

    const key = `${line.productId}:${batchId ?? ''}`;
    const prev = grouped.get(key);
    const qty = (prev?.qty ?? d(0)).plus(line.qtyBaseUnit.toString());
    const unitCost = qty.eq(0)
      ? d(line.unitPrice.toString())
      : (prev?.qty ?? d(0))
          .mul(prev?.unitCost ?? d(0))
          .plus(d(line.qtyBaseUnit.toString()).mul(line.unitPrice.toString()))
          .div(qty);

    grouped.set(key, {
      productId: line.productId,
      batchId,
      qty,
      unitCost,
    });
  }

  const groupedValues = [...grouped.values()].sort((a, b) =>
    `${a.productId}:${a.batchId ?? ''}`.localeCompare(`${b.productId}:${b.batchId ?? ''}`),
  );
  const batchIds = [...new Set(groupedValues.map((item) => item.batchId).filter((id): id is string => Boolean(id)))];

  if (batchIds.length > 0) {
    const [balanceRows, batchRows] = await Promise.all([
      trx.stockBalance.findMany({
        where: {
          tenantId,
          warehouseId: receipt.warehouse_id,
          batchId: { in: batchIds },
        },
      }),
      trx.batch.findMany({
        where: { id: { in: batchIds } },
      }),
    ]);

    const balanceMap = new Map<string, ReturnType<typeof d>>();
    for (const row of balanceRows) {
      const next = (balanceMap.get(row.batchId ?? '') ?? d(0)).plus(row.onhandQty.toString());
      balanceMap.set(row.batchId ?? '', next);
    }
    const batchMap = new Map(batchRows.map((row) => [row.id, row]));

    for (const g of groupedValues) {
      if (!g.batchId) continue;
      const currentOnhand = balanceMap.get(g.batchId) ?? d(0);
      const batch = batchMap.get(g.batchId);
      if (!batch) continue;
      const unitCost = currentOnhand.gt(0)
        ? currentOnhand.mul(batch.unitCost.toString()).plus(g.qty.mul(g.unitCost)).div(currentOnhand.plus(g.qty))
        : g.unitCost;
      await trx.batch.update({
        where: { id: g.batchId },
        data: { unitCost: toDecimalString(unitCost, 4) },
      });
    }
  }

  return groupedValues.map((g) => ({
    tenantId,
    productId: g.productId,
    warehouseId: receipt.warehouse_id,
    batchId: g.batchId,
    qtyBaseUnit: toDecimalString(g.qty, 4),
    unitCost: toDecimalString(g.unitCost, 4),
  }));
}
