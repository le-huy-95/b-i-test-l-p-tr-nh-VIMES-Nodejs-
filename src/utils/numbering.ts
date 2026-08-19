import { Prisma } from '../infra/prisma-types';
import { prisma } from '../infra/prisma';

const PREFIX: Record<string, string> = {
  stock_receipt: 'PNK',
  stock_issue: 'PXK',
  stock_opening: 'TDK',
  stock_transfer: 'PCK',
  stock_count: 'BBKK',
};

export class NumberingService {
  constructor(private readonly db: Prisma.TransactionClient = prisma) {}

  async generateNextCode(
    tenantId: string,
    docType: string,
    trx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = trx ?? this.db;
    const year = new Date().getFullYear();
    const prefix = PREFIX[docType] ?? 'DOC';

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

export const numberingService = new NumberingService(prisma);

export async function generateNextCode(
  tenantId: string,
  docType: string,
  trx: Prisma.TransactionClient = prisma,
): Promise<string> {
  return numberingService.generateNextCode(tenantId, docType, trx);
}
