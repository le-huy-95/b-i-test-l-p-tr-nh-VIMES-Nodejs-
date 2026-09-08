/**
 * Schema phân trang dùng chung và helper đóng gói kết quả paginated.
 *
 * Chuẩn hóa page/limit/search từ query string và cấu trúc phản hồi { data, pagination }.
 */
import { z } from "zod";

/* Schema query phân trang — coerce string sang number, giới hạn limit tối đa 200 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/* Cấu trúc phản hồi danh sách có phân trang — generic theo kiểu phần tử T */
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Đóng gói mảng dữ liệu đã slice cùng metadata phân trang.
 * totalPages = ceil(total / limit), tối thiểu 0 khi total = 0.
 */
export function paginate<T>(
  data: T[],
  page: number,
  limit: number,
  total: number,
): PaginatedResult<T> {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  };
}
