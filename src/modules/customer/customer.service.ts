/**
 * DỊCH VỤ KHÁCH HÀNG
 * ------------------
 * Master data khách hàng, cache danh sách trong Redis.
 */
import type { PrismaClient } from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import { AppError } from "../../utils/app-error";
import { customerSchema } from "../../dto/customer.dto";
import { paginationSchema, paginate } from "../../dto/pagination.dto";
import { listCache } from "../../infra/redis-list-cache";
import type { ListCache } from "../common/list-cache.port";
import { cacheInvalidationService } from "../../infra/cache-invalidation";

const CACHE_PREFIX = "list:customers";

export class CustomerService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly cache: ListCache = listCache,
  ) {}

  async list(tenantId: string, query?: unknown) {
    const cacheSuffix =
      !query || Object.keys(query as object).length === 0
        ? "all"
        : JSON.stringify(paginationSchema.parse(query));
    const cacheKey = `${CACHE_PREFIX}:${tenantId}:${cacheSuffix}`;
    return this.cache.getOrSet(cacheKey, async () => {
      if (!query || Object.keys(query as object).length === 0) {
        return this.db.customer.findMany({
          where: { tenantId, isActive: true },
          orderBy: { code: "asc" },
        });
      }

      const { page, limit, search } = paginationSchema.parse(query);
      const where = {
        tenantId,
        isActive: true,
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: "insensitive" as const } },
                { name: { contains: search, mode: "insensitive" as const } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      };
      const [data, total] = await Promise.all([
        this.db.customer.findMany({
          where,
          orderBy: { code: "asc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.customer.count({ where }),
      ]);
      return paginate(data, page, limit, total);
    });
  }

  async create(tenantId: string, input: unknown) {
    const data = customerSchema.parse(input);
    try {
      const result = await this.db.customer.create({
        data: { tenantId, ...data },
      });
      await cacheInvalidationService.invalidateMasterData(tenantId);
      return result;
    } catch {
      throw new AppError("DUPLICATE_CODE", 409, "Customer code exists");
    }
  }

  async get(tenantId: string, id: string) {
    const row = await this.db.customer.findFirst({ where: { id, tenantId } });
    if (!row) throw new AppError("NOT_FOUND", 404, "Customer not found");
    return row;
  }

  async update(tenantId: string, id: string, input: unknown) {
    await this.get(tenantId, id);
    const data = customerSchema.partial().parse(input);
    const result = await this.db.customer.update({ where: { id }, data });
    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }

  async softDelete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const result = await this.db.customer.update({
      where: { id },
      data: { isActive: false },
    });
    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }
}

export const customerService = new CustomerService(prisma, listCache);
