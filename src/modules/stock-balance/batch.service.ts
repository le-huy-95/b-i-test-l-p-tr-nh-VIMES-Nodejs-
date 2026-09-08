/**
 * DỊCH VỤ LÔ HÀNG (BATCH)
 * -----------------------
 * Tạo/quản lý batch theo sản phẩm+kho, hạn sử dụng, số lô.
 */
import type { Prisma } from '../../infra/prisma-types';
import { AppError } from '../../utils/app-error';

export interface EnsureBatchInput {
  tenantId: string;
  productId: string;
  batchNo: string;
  warehouseId?: string | null;
  expiryDate?: Date | null;
  manufactureDate?: Date | null;
  supplierId?: string | null;
  unitCost?: string;
  receiptDetailId?: string | null;
}

export async function ensureBatch(
  trx: Prisma.TransactionClient,
  input: EnsureBatchInput,
): Promise<string> {
  const batchNo = input.batchNo.trim();
  if (!batchNo) {
    throw new AppError('VALIDATION_ERROR', 400, 'batchNo is required');
  }

  const existing = await trx.batch.findUnique({
    where: {
      tenantId_productId_batchNo: {
        tenantId: input.tenantId,
        productId: input.productId,
        batchNo,
      },
    },
  });
  if (existing) {
    const expiryDate = existing.expiryDate ?? input.expiryDate ?? undefined;
    const manufactureDate = existing.manufactureDate ?? input.manufactureDate ?? undefined;
    if (
      (expiryDate && !existing.expiryDate) ||
      (manufactureDate && !existing.manufactureDate) ||
      (input.receiptDetailId && !existing.receiptDetailId)
    ) {
      await trx.batch.update({
        where: { id: existing.id },
        data: {
          expiryDate,
          manufactureDate,
          receiptDetailId: existing.receiptDetailId ?? input.receiptDetailId,
        },
      });
    }
    return existing.id;
  }

  const created = await trx.batch.create({
    data: {
      tenantId: input.tenantId,
      productId: input.productId,
      warehouseId: input.warehouseId ?? undefined,
      batchNo,
      expiryDate: input.expiryDate ?? undefined,
      manufactureDate: input.manufactureDate ?? undefined,
      supplierId: input.supplierId ?? undefined,
      receiptDetailId: input.receiptDetailId ?? undefined,
      unitCost: input.unitCost ?? 0,
    },
  });
  return created.id;
}
