/**
 * Tải và biên dịch template email Handlebars (.hbs).
 *
 * Module này quản lý vòng đời template:
 * - Đọc file .hbs từ thư mục dist (production) hoặc src (development)
 * - Đăng ký partial `layout` dùng chung cho mọi template
 * - Cache template đã compile trong memory để tránh đọc/compile lại mỗi lần gửi
 *
 * Template nằm tại `src/services/email/templates/*.hbs`.
 */

import fs from 'fs/promises';
import path from 'path';
import Handlebars from 'handlebars';

/** Cache template đã compile theo tên — key là tên file (không có .hbs) */
const cache = new Map<string, HandlebarsTemplateDelegate>();

/**
 * Đọc nội dung file template từ đĩa.
 * Ưu tiên đường dẫn trong dist (sau build); fallback sang src khi chạy dev/ts-node.
 */
async function readTemplateFile(templateName: string): Promise<string> {
  const fromDist = path.join(__dirname, 'templates', `${templateName}.hbs`);
  const fromSrc = path.join(
    process.cwd(),
    'src',
    'services',
    'email',
    'templates',
    `${templateName}.hbs`,
  );
  const filePath = (await fs.access(fromDist).then(() => fromDist).catch(() => fromSrc));
  return fs.readFile(filePath, 'utf8');
}

/**
 * API tải template — export object singleton dùng bởi EmailService.
 */
export const templateLoader = {
  /**
   * Đảm bảo partial `layout` đã được đăng ký với Handlebars.
   * Chỉ compile và register một lần; các lần sau bỏ qua nếu partial đã tồn tại.
   */
  async ensureLayout(): Promise<void> {
    if (Handlebars.partials['layout']) return;
    const source = await readTemplateFile('layout');
    Handlebars.registerPartial('layout', Handlebars.compile(source));
  },

  /**
   * Lấy hàm render template theo tên.
   * Trả về từ cache nếu đã compile; nếu chưa thì đọc file, compile, cache rồi trả về.
   */
  async getTemplate(templateName: string): Promise<HandlebarsTemplateDelegate> {
    const cached = cache.get(templateName);
    if (cached) return cached;

    await this.ensureLayout();
    const source = await readTemplateFile(templateName);
    const compiled = Handlebars.compile(source);
    cache.set(templateName, compiled);
    return compiled;
  },
};
