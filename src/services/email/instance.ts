/**
 * Khởi tạo singleton EmailService cho toàn ứng dụng.
 *
 * File này tạo một instance duy nhất của EmailService, gắn với Prisma client
 * mặc định từ infra. Mọi handler và module khác import `emailService` từ đây
 * để tránh khởi tạo nhiều transporter/template loader và đảm bảo log email
 * ghi vào cùng một database connection pool.
 */

import { EmailService } from './EmailService.class';
import { prisma } from '../../infra/prisma';

/** Instance EmailService dùng chung — inject Prisma client mặc định của ứng dụng */
export const emailService = new EmailService(prisma);
