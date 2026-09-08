/**
 * DỊCH VỤ LIÊN HỆ
 * ---------------
 * CRUD contact trong tenant, cache danh sách.
 */
import type {
  PrismaClient,
  ContactRelationType,
} from "../../infra/prisma-types";
import { prisma } from "../../infra/prisma";
import { AppError } from "../../utils/app-error";
import { contactSchema } from "./contact.dto";
import { listCache } from "../../infra/redis-list-cache";
import type { ListCache } from "../common/list-cache.port";
import { cacheInvalidationService } from "../../infra/cache-invalidation";

const CACHE_PREFIX = "list:contacts";

export class ContactService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly cache: ListCache = listCache,
  ) {}

  async listByRelationType(
    tenantId: string,
    relationType: ContactRelationType,
    limit?: number,
  ) {
    const cacheKey = `${CACHE_PREFIX}:${tenantId}:${relationType}:${limit || "all"}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const where = {
      tenantId,
      relationType,
      isActive: true,
    };

    const data = await this.db.contact.findMany({
      where,
      orderBy: { fullName: "asc" },
      take: limit,
    });

    await this.cache.set(cacheKey, data);
    return data;
  }

  async create(tenantId: string, input: unknown) {
    const data = contactSchema.parse(input);

    const result = await this.db.contact.create({
      data: {
        tenantId,
        kind: "external",
        relationType: data.relationType,
        fullName: data.fullName,
        phone: data.phone,
        email: data.email,
        companyName: data.companyName,
        taxCode: data.taxCode,
        note: data.note,
      },
    });

    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }

  async get(tenantId: string, id: string) {
    const row = await this.db.contact.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new AppError("NOT_FOUND", 404, "Contact not found");
    return row;
  }

  async update(tenantId: string, id: string, input: unknown) {
    await this.get(tenantId, id);
    const data = contactSchema.partial().parse(input);
    const result = await this.db.contact.update({ where: { id }, data });
    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }

  async softDelete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const result = await this.db.contact.update({
      where: { id },
      data: { isActive: false },
    });
    await cacheInvalidationService.invalidateMasterData(tenantId);
    return result;
  }
}

export const contactService = new ContactService(prisma, listCache);
