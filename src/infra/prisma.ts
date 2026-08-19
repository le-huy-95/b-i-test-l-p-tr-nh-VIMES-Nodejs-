import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./prisma-types";
import { Pool } from "pg";
import { env } from "../config/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  console.log("PostgreSQL (Prisma) connected");
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
  console.log("PostgreSQL connection closed");
}
