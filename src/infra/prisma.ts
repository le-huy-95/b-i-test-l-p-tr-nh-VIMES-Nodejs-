/**
 * Cấu hình và quản lý kết nối PostgreSQL thông qua Prisma ORM.
 *
 * Module này khởi tạo PrismaClient với adapter pg (connection pool),
 * tái sử dụng instance singleton trong môi trường development để tránh
 * tạo quá nhiều kết nối khi hot-reload, và cung cấp hàm connect/close
 * cho vòng đời ứng dụng (startup / graceful shutdown).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./prisma-types";
import { Pool } from "pg";
import { env } from "../config/env";

// Biến global để giữ singleton PrismaClient khi dev hot-reload
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Connection pool PostgreSQL — dùng chung cho Prisma adapter
const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

// Khởi tạo PrismaClient: tái dùng instance cũ hoặc tạo mới với adapter pg
export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Gắn vào global ở môi trường non-production để tránh tạo nhiều client khi reload
if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Mở kết nối tới PostgreSQL qua Prisma.
 * Gọi khi khởi động ứng dụng.
 */
export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  console.log("PostgreSQL (Prisma) connected");
}

/**
 * Đóng kết nối Prisma và giải phóng connection pool.
 * Gọi khi shutdown ứng dụng.
 */
export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
  console.log("PostgreSQL connection closed");
}
