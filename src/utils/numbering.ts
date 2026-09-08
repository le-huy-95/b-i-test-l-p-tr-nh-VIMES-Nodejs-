/**
 * Dịch vụ sinh mã chứng từ tự động theo tenant, loại chứng từ và năm.
 *
 * Dùng bảng numbering_counters với UPSERT atomic để đảm bảo số thứ tự không trùng
 * ngay cả khi nhiều request đồng thời. Định dạng: {PREFIX}-{YEAR}-{SEQ 6 chữ số}.
 */
import { Prisma } from '../infra/prisma-types';
import { prisma } from '../infra/prisma';

/* Ánh xạ loại chứng từ (doc_type) sang tiền tố mã viết tắt tiếng Việt */
const PREFIX: Record<string, string> = {
  stock_receipt: 'PNK',
  stock_issue: 'PXK',
  stock_opening: 'TDK',
  stock_transfer: 'PCK',
  stock_count: 'BBKK',
};

/** Dịch vụ sinh mã — có thể inject TransactionClient để chạy trong transaction */
export class NumberingService {
  constructor(private readonly db: Prisma.TransactionClient = prisma) {}

  /**
   * Tăng bộ đếm và trả về mã chứng từ mới.
   * Nếu truyền trx thì dùng client transaction; không thì dùng client mặc định.
   */
  async generateNextCode(
    tenantId: string,
    docType: string,
    trx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = trx ?? this.db;
    const year = new Date().getFullYear();
    const prefix = PREFIX[docType] ?? 'DOC';

    /* UPSERT atomic: insert lần đầu = 1, conflict thì tăng current_value + 1 */
    const rows = await client.$queryRaw<Array<{ current_value: bigint }>>`
      INSERT INTO numbering_counters (tenant_id, doc_type, year, prefix, current_value)
      VALUES (${tenantId}, ${docType}, ${year}, ${prefix}, 1)
      ON CONFLICT (tenant_id, doc_type, year)
      DO UPDATE SET current_value = numbering_counters.current_value + 1
      RETURNING current_value
    `;

    const seq = rows[0].current_value.toString().padStart(6, '0');
    return `${prefix}-${year}-${seq}`;
  }
}

/* Singleton mặc định dùng prisma client toàn cục */
export const numberingService = new NumberingService(prisma);

/** Hàm tiện ích gọi numberingService — hỗ trợ truyền transaction client */
export async function generateNextCode(
  tenantId: string,
  docType: string,
  trx: Prisma.TransactionClient = prisma,
): Promise<string> {
  return numberingService.generateNextCode(tenantId, docType, trx);
}
